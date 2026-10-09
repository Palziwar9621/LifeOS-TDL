// Real model installer/PCM session code; platform/Vosk JNI are test doubles.
// Model extraction verifies the actual bundled archive, without any downloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const native = join(root, 'LifeOS/android-build/app/src/main/java/app/lifeos/twa');
const model = join(root, 'LifeOS/android-build/app/src/main/assets/speech/vosk-model-small-en-us-0.15.zip');

function javaTest(sources, production, main, args = []) {
  const parent = join(tmpdir(), 'omnirush');
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'lifeos-embedded-'));
  try {
    const files = Object.entries(sources).map(([name, content]) => {
      const path = join(dir, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); return path;
    });
    const compile = spawnSync('javac', ['-d', dir, ...files, ...production.map(name => join(native, name))], { encoding: 'utf8' });
    assert.equal(compile.status, 0, `${compile.error ?? ''}\n${compile.stdout}\n${compile.stderr}`);
    const result = spawnSync('java', ['-cp', dir, main, dir, ...args], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /scenarios passed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('bundled official model: digest, atomic extraction, cached reuse, damaged install and unsafe archives', () => {
  javaTest({
    'app/lifeos/twa/ModelStoreTest.java': `package app.lifeos.twa;
      import java.io.*;import java.nio.file.*;import java.util.zip.*;
      public class ModelStoreTest {
        static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
        public static void main(String[] args)throws Exception{
          File parent=new File(args[0],"models");File archive=new File(args[1]);
          File installed=SpeechModelStore.prepare(parent,()->new FileInputStream(archive));
          check(new File(installed,"am/final.mdl").length()>1000000,"actual acoustic model extracted");
          check(new String(Files.readAllBytes(new File(installed,"README").toPath())).contains("Copyright 2020 Alpha Cephei Inc"),"publisher notice preserved");
          File reused=SpeechModelStore.prepare(parent,()->{throw new AssertionError("cached model reopened archive");});
          check(installed.equals(reused),"verified installation reused without extraction");
          Files.delete(new File(installed,"conf/model.conf").toPath());
          SpeechModelStore.prepare(parent,()->new FileInputStream(archive));
          check(new File(installed,"conf/model.conf").isFile(),"incomplete install repaired");
          byte[] truncated=new byte[1024];try(InputStream input=new FileInputStream(archive)){input.read(truncated);}
          File badParent=new File(args[0],"truncated");
          try{SpeechModelStore.prepare(badParent,()->new ByteArrayInputStream(truncated));throw new AssertionError("truncated archive accepted");}catch(IOException expected){}
          check(badParent.listFiles().length==0,"failed extraction leaves no committed or staging model");
          ByteArrayOutputStream bytes=new ByteArrayOutputStream();
          try(ZipOutputStream zip=new ZipOutputStream(bytes)){zip.putNextEntry(new ZipEntry(SpeechModelStore.NAME+"/../../escape"));zip.write(1);zip.closeEntry();}
          try{SpeechModelStore.prepare(new File(args[0],"unsafe"),()->new ByteArrayInputStream(bytes.toByteArray()));throw new AssertionError("path traversal accepted");}catch(IOException expected){}
          check(!new File(args[0],"escape").exists(),"archive cannot escape model staging");
          check(!SpeechText.accept("your task is ready","Your task is ready",true,false),"exact playback echo suppressed");
          check(!SpeechText.accept("task ready your","Your task is ready",true,false),"high-overlap echo suppressed");
          check(!SpeechText.accept("add task now","Your task is ready",true,false),"non-interruption text suppressed during TTS");
          check(SpeechText.accept("please stop","Your task is ready",true,false),"novel stop prefix accepted");
          check(!SpeechText.accept("stop","Say stop to cancel",true,false),"ambiguous playback stop is suppressed rather than self-triggering");
          check(SpeechText.accept("add task now","Your task is ready",false,false),"normal commands accepted when not speaking");
          check(SpeechText.wakeSpelling("hey life o s stop").equals("hey lifeos stop"),"model spelling normalized for existing web wake API");
          System.out.println("Model installation and echo policy scenarios passed");
        }
      }`,
  }, ['SpeechModelStore.java', 'SpeechText.java'], 'app.lifeos.twa.ModelStoreTest', [model]);
});

test('actual PCM engine: cancelled cold start, cached model, streaming silence, exclusive handoff, decoder reset and faults', () => {
  javaTest({
    'android/os/Looper.java': `package android.os;public class Looper{public static Looper getMainLooper(){return new Looper();}}`,
    'android/os/Handler.java': `package android.os;import java.util.concurrent.*;public class Handler{
      static ConcurrentLinkedQueue<Runnable> queue=new ConcurrentLinkedQueue<>();public Handler(Looper l){}public void post(Runnable r){queue.add(r);}
      public static void drain(){Runnable r;while((r=queue.poll())!=null)r.run();}
    }`,
    'android/content/Context.java': `package android.content;public class Context{
      public Context getApplicationContext(){return this;}public java.io.File getNoBackupFilesDir(){return new java.io.File("unused");}
      public android.content.res.AssetManager getAssets(){return new android.content.res.AssetManager();}
    }`,
    'android/content/res/AssetManager.java': `package android.content.res;public class AssetManager{public java.io.InputStream open(String name){return new java.io.ByteArrayInputStream(new byte[0]);}}`,
    'android/media/AudioFormat.java': `package android.media;public class AudioFormat{public static final int CHANNEL_IN_MONO=1,ENCODING_PCM_16BIT=2;}`,
    'android/media/MediaRecorder.java': `package android.media;public class MediaRecorder{public static class AudioSource{public static final int VOICE_COMMUNICATION=7,VOICE_RECOGNITION=6;}}`,
    'android/media/AudioRecord.java': `package android.media;import java.util.*;import java.util.concurrent.*;
      public class AudioRecord{
        public static final int STATE_INITIALIZED=1,RECORDSTATE_RECORDING=3,READ_BLOCKING=0;public static volatile boolean failCommunication;
        public static List<AudioRecord> all=new CopyOnWriteArrayList<>();public static volatile int active,maxActive;
        public final int source;public volatile boolean recording,released;public BlockingQueue<Short> samples=new LinkedBlockingQueue<>();
        public AudioRecord(int source,int rate,int channel,int format,int buffer){this.source=source;all.add(this);}
        public static int getMinBufferSize(int r,int c,int f){return 3200;}public int getState(){return failCommunication&&source==7?0:1;}
        public int getAudioSessionId(){return 1;}public void startRecording(){recording=true;active++;maxActive=Math.max(maxActive,active);}
        public int getRecordingState(){return recording?3:1;}public int read(short[] pcm,int offset,int length,int mode){
          try{short value=samples.take();if(value<0)return -1;pcm[offset]=value;return 1;}catch(InterruptedException e){return -1;}
        }
        public void stop(){if(recording){recording=false;active--;samples.offer((short)-1);}}public void release(){stop();released=true;}
      }`,
    'android/media/audiofx/AcousticEchoCanceler.java': `package android.media.audiofx;public class AcousticEchoCanceler{
      public static boolean available=true;boolean enabled;public static boolean isAvailable(){return available;}
      public static AcousticEchoCanceler create(int id){return new AcousticEchoCanceler();}public void setEnabled(boolean value){enabled=value;}
      public boolean getEnabled(){return enabled;}public void release(){}
    }`,
    'org/json/JSONObject.java': `package org.json;public class JSONObject{String value;public JSONObject(String value){this.value=value;}public String optString(String key,String fallback){return value;}}`,
    'org/vosk/LibVosk.java': `package org.vosk;public class LibVosk{public static void vosk_set_log_level(int l){}}`,
    'org/vosk/Model.java': `package org.vosk;import java.util.concurrent.*;public class Model{
      public static volatile int loads,closes;public static CountDownLatch entered=new CountDownLatch(1),gate=new CountDownLatch(1);
      public Model(String path)throws java.io.IOException{loads++;entered.countDown();try{gate.await();}catch(InterruptedException e){throw new java.io.IOException(e);}}
      public void close(){closes++;}
    }`,
    'org/vosk/Recognizer.java': `package org.vosk;import java.util.*;import java.util.concurrent.*;public class Recognizer{
      public static List<Recognizer> all=new CopyOnWriteArrayList<>();public volatile int resets,closes;short value;
      public Recognizer(Model m,float rate){all.add(this);}public boolean acceptWaveForm(short[] pcm,int count){value=pcm[0];return value==2||value==3;}
      public String getResult(){return value==3?"":"hello there";}public String getPartialResult(){return value==4?"stop":"hello";}
      public void reset(){resets++;}public void close(){closes++;}
    }`,
    'app/lifeos/twa/SpeechModelStore.java': `package app.lifeos.twa;import java.io.*;final class SpeechModelStore{
      static String ASSET="unused";interface Archive{InputStream open()throws IOException;}static File prepare(File p,Archive a){return p;}
    }`,
    'app/lifeos/twa/PcmEngineTest.java': `package app.lifeos.twa;
      import android.content.*;import android.os.*;import android.media.*;import org.vosk.*;import java.util.*;import java.util.concurrent.*;import java.util.function.*;
      public class PcmEngineTest {
        static class Events implements EmbeddedSpeechEngine.Listener{
          List<String> texts=new ArrayList<>();List<String> errors=new ArrayList<>();int ready;boolean aec;
          public void onReady(boolean e){ready++;aec=e;}public void onText(String s,boolean f){texts.add((f?"final:":"partial:")+s);}public void onError(String s){errors.add(s);}
        }
        static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
        static void waitFor(BooleanSupplier condition,String message)throws Exception{
          long deadline=System.currentTimeMillis()+5000;while(System.currentTimeMillis()<deadline){Handler.drain();if(condition.getAsBoolean())return;Thread.sleep(5);}throw new AssertionError(message);
        }
        static AudioRecord audio(){return AudioRecord.all.get(AudioRecord.all.size()-1);}
        public static void main(String[] args)throws Exception{
          try{
            Context context=new Context();Events cancelled=new Events();EmbeddedSpeechEngine.Session first=EmbeddedSpeechEngine.start(context,cancelled);
            check(Model.entered.await(5,TimeUnit.SECONDS),"cold model loading started");first.stop();Model.gate.countDown();
            Events events=new Events();EmbeddedSpeechEngine.Session session=EmbeddedSpeechEngine.start(context,events);waitFor(()->events.ready==1,"second owner did not become ready");
            check(cancelled.ready==0&&AudioRecord.all.size()==1,"cancelled cold start cannot later acquire microphone");
            check(Model.loads==1,"cold load shared with next session");check(audio().source==7&&events.aec,"communication source and available echo canceller enabled");
            Events busy=new Events();EmbeddedSpeechEngine.start(context,busy);waitFor(()->!busy.errors.isEmpty(),"busy owner not rejected");
            check(AudioRecord.all.size()==1&&busy.errors.contains("microphone_in_use"),"two native owners cannot capture together");
            AudioRecord original=audio();original.samples.offer((short)1);waitFor(()->events.texts.size()==1,"partial missing");
            original.samples.offer((short)2);waitFor(()->events.texts.size()==2,"final missing");
            original.samples.offer((short)3);waitFor(()->events.texts.size()==3,"empty endpoint missing");
            check(events.texts.equals(Arrays.asList("partial:hello","final:hello there","final:")),"partial/final stream contract");
            check(AudioRecord.all.size()==1&&original.recording,"silence retains same recorder");
            int before=events.texts.size();session.resetDecoder();original.samples.offer((short)4);
            waitFor(()->Recognizer.all.get(0).resets==1,"decoder reset missing");
            check(events.texts.size()==before,"queued old-epoch result rejected");
            original.samples.offer((short)4);waitFor(()->events.texts.size()==before+1,"new-epoch result missing");
            session.stop();check(!original.recording&&AudioRecord.active==0,"stop synchronously relinquishes capture");
            waitFor(()->original.released,"worker did not release recorder");check(Recognizer.all.get(0).closes==1,"decoder released once");
            Events next=new Events();EmbeddedSpeechEngine.Session nextSession=EmbeddedSpeechEngine.start(context,next);waitFor(()->next.ready==1,"handoff owner missing");
            check(Model.loads==1&&AudioRecord.maxActive==1,"model cached and microphone exclusive");
            AudioRecord bad=audio();bad.samples.offer((short)-1);waitFor(()->!next.errors.isEmpty(),"capture failure not reported");
            check(next.errors.size()==1&&bad.released,"capture failure releases resources without retry");nextSession.stop();
            AudioRecord.failCommunication=true;android.media.audiofx.AcousticEchoCanceler.available=false;
            Events fallback=new Events();EmbeddedSpeechEngine.Session fallbackSession=EmbeddedSpeechEngine.start(context,fallback);waitFor(()->fallback.ready==1,"PCM source fallback failed");
            check(audio().source==6&&!fallback.aec,"fallback remains app-owned PCM and reports unavailable AEC");
            AudioRecord last=audio();fallbackSession.stop();waitFor(()->last.released,"fallback cleanup missing");
            EmbeddedSpeechEngine.releaseIdleModel();waitFor(()->Model.closes==1,"memory-pressure cache release missing");
            System.out.println("PCM lifecycle scenarios passed");System.exit(0);
          }catch(Throwable failure){failure.printStackTrace();System.exit(1);}
        }
      }`,
  }, ['EmbeddedSpeechEngine.java', 'SpeechText.java'], 'app.lifeos.twa.PcmEngineTest');
});
