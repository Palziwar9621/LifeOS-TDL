// Runs the actual SpeechBridge.java against deterministic Android test doubles.
// Requires JDK 17 on PATH. No emulator, downloads, signing or Gradle dependencies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const native = join(root, 'LifeOS/android-build/app/src/main/java/app/lifeos/twa');

test('native speech: queued TTS, concurrent PCM barge-in, echo rejection, permissions and microphone ownership', () => {
  const parent = join(tmpdir(), 'omnirush');
  mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(join(parent, 'lifeos-speech-'));
  const sources = {
    'android/os/Looper.java': `package android.os; public class Looper { public static Looper getMainLooper(){return new Looper();} }`,
    'android/os/Handler.java': `package android.os;
      import java.util.*;
      public class Handler {
        static class Task { Handler owner; Runnable run; long at; Task(Handler h,Runnable r,long a){owner=h;run=r;at=a;} }
        static List<Task> tasks=new ArrayList<>(); static long now;
        public Handler(Looper l){}
        public void post(Runnable r){postDelayed(r,0);}
        public void postDelayed(Runnable r,long delay){tasks.add(new Task(this,r,now+delay));}
        public void removeCallbacks(Runnable r){tasks.removeIf(t->t.owner==this&&t.run==r);}
        public void removeCallbacksAndMessages(Object o){tasks.removeIf(t->t.owner==this);}
        public static void reset(){tasks.clear();now=0;}
        public static void drain(){ for(int limit=0;limit<1000;limit++){Task next=null;for(Task t:tasks)if(t.at<=now){next=t;break;}if(next==null)return;tasks.remove(next);next.run.run();}throw new AssertionError("unbounded handler loop"); }
        public static void advance(long ms){now+=ms;drain();}
      }`,
    'android/os/Build.java': `package android.os; public class Build { public static class VERSION { public static int SDK_INT=31; } }`,
    'android/os/SystemClock.java': `package android.os;public class SystemClock {public static long elapsedRealtime(){return Handler.now;}}`,
    'android/os/Bundle.java': `package android.os; import java.util.*; public class Bundle { public ArrayList<String> words; public ArrayList<String> getStringArrayList(String k){return words;} }`,
    'android/content/Context.java': `package android.content; public class Context {
      public static final int MODE_PRIVATE=0;public SharedPreferences prefs=new SharedPreferences();public int permission=0;
      public Context getApplicationContext(){return this;}public int checkSelfPermission(String p){return permission;}
      public SharedPreferences getSharedPreferences(String name,int mode){return prefs;}
      public android.content.pm.PackageManager getPackageManager(){return new android.content.pm.PackageManager();}
      public String getPackageName(){return "app.lifeos.twa";}
      public <T> T getSystemService(Class<T> type){return type.cast(new android.app.NotificationManager());}
    }`,
    'android/content/SharedPreferences.java': `package android.content; public class SharedPreferences {
      public boolean enabled;public String word="hey lifeos";public boolean getBoolean(String k,boolean d){return enabled;}public String getString(String k,String d){return word;}
    }`,
    'android/content/Intent.java': `package android.content; public class Intent {String action; public Intent(String a){action=a;}public String getAction(){return action;} public Intent putExtra(String k,String v){return this;} public Intent putExtra(String k,boolean v){return this;} }`,
    'android/content/pm/PackageManager.java': `package android.content.pm; public class PackageManager {public static final int PERMISSION_GRANTED=0;public android.content.Intent getLaunchIntentForPackage(String p){return new android.content.Intent("launch");}}`,
    'android/app/Activity.java': `package android.app; public class Activity extends android.content.Context {
      public int permission=0, requests=0; public boolean finishing=false,dead=false;
      public android.os.Looper getMainLooper(){return android.os.Looper.getMainLooper();}
      public boolean isFinishing(){return finishing;} public boolean isDestroyed(){return dead;}
      public int checkSelfPermission(String p){return permission;}
      public void requestPermissions(String[] p,int code){requests++;}
    }`,
    'android/webkit/JavascriptInterface.java': `package android.webkit; public @interface JavascriptInterface {}`,
    'android/os/IBinder.java': `package android.os; public interface IBinder {}`,
    'android/R.java': `package android; public class R {public static class drawable {public static int ic_btn_speak_now=1;}}`,
    'android/app/Service.java': `package android.app; public class Service extends android.content.Context {
      public static final int START_NOT_STICKY=2;public int stops,foregrounds;public void onCreate(){}public void onDestroy(){}
      public int onStartCommand(android.content.Intent i,int f,int id){return 0;}public android.os.IBinder onBind(android.content.Intent i){return null;}
      public void startForeground(int id,Notification n){foregrounds++;}public void stopForeground(boolean remove){}public void stopSelf(){stops++;}
    }`,
    'android/app/PendingIntent.java': `package android.app; public class PendingIntent {public static final int FLAG_UPDATE_CURRENT=1,FLAG_IMMUTABLE=2;public static PendingIntent getActivity(android.content.Context c,int i,android.content.Intent t,int f){return new PendingIntent();}}`,
    'android/app/Notification.java': `package android.app; public class Notification {public static class Builder {
      public Builder(android.content.Context c){}public Builder(android.content.Context c,String ch){}
      public Builder setContentTitle(String s){return this;}public Builder setContentText(String s){return this;}
      public Builder setSmallIcon(int i){return this;}public Builder setOnlyAlertOnce(boolean b){return this;}
      public Builder setOngoing(boolean b){return this;}public Builder setContentIntent(PendingIntent i){return this;}
      public Builder setAutoCancel(boolean b){return this;}public Notification build(){return new Notification();}
    }}`,
    'android/app/NotificationChannel.java': `package android.app; public class NotificationChannel {
      public NotificationChannel(String i,String n,int p){}public void setDescription(String s){}public void setSound(Object u,Object a){}public void enableVibration(boolean b){}
    }`,
    'android/app/NotificationManager.java': `package android.app; public class NotificationManager {
      public static final int IMPORTANCE_LOW=2;public void createNotificationChannel(NotificationChannel c){}public void notify(int id,Notification n){}public void cancel(int id){}
    }`,
    'org/json/JSONObject.java': `package org.json; public class JSONObject {public static String quote(String s){return String.valueOf((char)34)+s+(char)34;}}`,
    'app/lifeos/twa/EmbeddedSpeechEngine.java': `package app.lifeos.twa;import java.util.*;import android.os.*;
      final class EmbeddedSpeechEngine {
        static List<Session> all=new ArrayList<>();interface Listener{void onReady(boolean aec);void onText(String text,boolean isFinal);void onError(String error);}
        static class Session {Listener listener;boolean stopped;int resets;void stop(){stopped=true;}void resetDecoder(){resets++;}}
        static Session start(android.content.Context c,Listener l){Session s=new Session();s.listener=l;all.add(s);new Handler(Looper.getMainLooper()).post(()->{if(!s.stopped)l.onReady(true);});return s;}
      }`,
    'android/speech/tts/UtteranceProgressListener.java': `package android.speech.tts; public abstract class UtteranceProgressListener {public abstract void onStart(String s);public abstract void onDone(String s);public abstract void onError(String s);public void onStop(String s,boolean i){}}`,
    'android/speech/tts/TextToSpeech.java': `package android.speech.tts; import android.content.Context;import android.os.Bundle;import java.util.*;
      public class TextToSpeech {
        public static final int SUCCESS=0,ERROR=-1,LANG_MISSING_DATA=-1,LANG_NOT_SUPPORTED=-2,QUEUE_FLUSH=0;
        public interface OnInitListener {void onInit(int status);}
        public static boolean inline; public static TextToSpeech last;public OnInitListener init;public UtteranceProgressListener listener;
        public List<String> texts=new ArrayList<>();public String id;public boolean shutdown;public int result=SUCCESS;
        public TextToSpeech(Context c,OnInitListener l){last=this;init=l;if(inline)l.onInit(SUCCESS);}
        public int setLanguage(Locale l){return 0;}public void setOnUtteranceProgressListener(UtteranceProgressListener l){listener=l;}
        public int speak(String text,int queue,Bundle b,String i){texts.add(text);id=i;return result;}
        public void stop(){if(id!=null&&listener!=null)listener.onStop(id,true);}public void shutdown(){shutdown=true;}
      }`,
    'app/lifeos/twa/MainActivity.java': `package app.lifeos.twa; import java.util.*; public class MainActivity extends android.app.Activity { public boolean trusted=true;public List<String> events=new ArrayList<>();public boolean isTrustedPage(){return trusted;}public void evaluateJs(String js){events.add(js);} }`,
    'app/lifeos/twa/SpeechLifecycleTest.java': `package app.lifeos.twa;
      import android.os.*;import android.speech.tts.*;import java.util.*;import static app.lifeos.twa.EmbeddedSpeechEngine.all;
      public class SpeechLifecycleTest {
        static MainActivity activity;static SpeechBridge bridge;
        static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
        static void setup(boolean inline){Handler.reset();all.clear();Build.VERSION.SDK_INT=31;TextToSpeech.inline=inline;activity=new MainActivity();bridge=new SpeechBridge(activity);bridge.onResume();Handler.drain();}
        static long events(String name){return activity.events.stream().filter(e->e.contains("."+name+"(")).count();}
        static EmbeddedSpeechEngine.Session latest(){return all.get(all.size()-1);}
        public static void main(String[] args){
          setup(false);
          check(bridge.ttsAvailable(),"initializing must not report unavailable");
          check(all.isEmpty(),"launch stays idle");
          bridge.speak("first");bridge.speak("latest");Handler.drain();
          check(TextToSpeech.last.texts.isEmpty(),"speech waits for initialization");
          TextToSpeech.last.init.onInit(0);Handler.drain();
          check(TextToSpeech.last.texts.equals(Arrays.asList("latest")),"latest queued reply is spoken once");
          check(events("onSpeakEnd")==0,"no false unavailable event");

          setup(true);
          check("ready".equals(bridge.getTtsState()),"synchronous initialization callback must see assigned engine");
          bridge.speak("one");Handler.drain();String first=TextToSpeech.last.id;
          bridge.speak("two");Handler.drain();String second=TextToSpeech.last.id;
          TextToSpeech.last.listener.onDone(first);Handler.drain();check(events("onSpeakEnd")==0,"old completion cannot finish new speech");
          TextToSpeech.last.listener.onDone(second);TextToSpeech.last.listener.onDone(second);Handler.drain();
          check(events("onSpeakEnd")==1,"completion delivered once");

          setup(false);bridge.speak("cancel before ready");bridge.stopSpeak();Handler.drain();
          TextToSpeech.last.init.onInit(0);Handler.drain();
          check(TextToSpeech.last.texts.isEmpty(),"cancel clears queued speech");
          check(events("onSpeakEnd")==0,"explicit cancellation cannot finish a replacement web callback");

          setup(true);bridge.speak("old reply");Handler.drain();String cancelledReply=TextToSpeech.last.id;
          bridge.stopSpeak();bridge.speak("replacement reply");Handler.drain();
          TextToSpeech.last.listener.onDone(cancelledReply);Handler.drain();
          check(events("onSpeakEnd")==0,"stop-then-speak cannot emit stale completion to replacement");

          setup(false);bridge.speak("cannot initialize");Handler.drain();Handler.advance(15000);
          check(!bridge.ttsAvailable(),"timeout reports actual failure");
          check(events("onSpeakEnd")==1,"timeout completes queued speech");
          TextToSpeech.last.init.onInit(0);Handler.drain();
          check(!bridge.ttsAvailable(),"late readiness cannot resurrect timed out engine");

          setup(true);bridge.startContinuous();bridge.startContinuous();Handler.drain();
          check(all.size()==1,"duplicate start takes mic once");
          check("vosk-en-us-0.15".equals(bridge.recognitionEngine()),"bundled offline engine is default");
          EmbeddedSpeechEngine.Session old=latest();old.listener.onText("hello",false);
          check(events("onSpeechBeginning")==1,"non-echo speech beginning forwarded");
          old.listener.onText("hello there",true);old.listener.onText("",true);Handler.advance(60000);
          check(all.size()==1&&!old.stopped,"silence and phrases keep same PCM session without restart");
          bridge.stopContinuous();Handler.drain();old.listener.onText("late command",true);Handler.advance(10000);
          check(events("onSpeechResult")==1&&old.stopped,"cancel invalidates late results");

          for(String error:new String[]{"9","offline_speech_failed","embedded_engine_unavailable","microphone_in_use"}){
            setup(true);bridge.startContinuous();Handler.drain();latest().listener.onError(error);Handler.advance(60000);
            check(all.size()==1&&latest().stopped,"no retry loop for error "+error);
            check(events("onSpeechStopped")==1,"terminal state is explicit for error "+error);
          }

          setup(true);bridge.startContinuous();Handler.drain();old=latest();
          bridge.speak("Your morning task is ready");Handler.drain();check(!old.stopped&&old.resets==1,"TTS retains PCM with a fresh decoder phrase");
          old.listener.onText("your morning task",false);old.listener.onText("your morning task is ready",true);
          check(events("onSpeechBeginning")==0&&events("onSpeakEnd")==0,"playback echo cannot interrupt itself");
          old.listener.onText("add a task",false);check(events("onSpeechBeginning")==0,"arbitrary playback-time text is conservatively ignored");
          old.listener.onText("stop",false);Handler.drain();
          check(events("onSpeakEnd")==1&&events("onSpeechBeginning")==1&&events("onSpeechPartial")==1,"spoken stop interrupts TTS before final transcript");
          old.listener.onText("stop",true);check(events("onSpeechResult")==1,"interruption final still reaches page");
          check(all.size()==1&&!old.stopped,"spoken interruption has no microphone restart");
          bridge.speak("Another reply");Handler.drain();String reply=TextToSpeech.last.id;
          TextToSpeech.last.listener.onDone(reply);TextToSpeech.last.listener.onDone(reply);Handler.drain();Handler.advance(750);
          check(all.size()==1,"TTS completion does not restart PCM");
          bridge.speak("interruptible reply");Handler.drain();bridge.listen();Handler.drain();
          check(all.size()==2&&old.stopped,"explicit one-shot replaces continuous owner");
          Handler.advance(20000);check(latest().stopped,"one-shot silence has a finite deadline");

          setup(true);activity.permission=-1;bridge.listen();Handler.drain();check(activity.requests==1,"one-shot requests permission");
          bridge.onPause();activity.permission=0;bridge.onPermissionResult(2002,new int[]{0});
          check(all.isEmpty(),"grant cannot start while paused");bridge.onResume();
          check(all.size()==1,"one-shot resumes explicit pending request");
          setup(true);activity.permission=-1;bridge.startContinuous();Handler.drain();bridge.stopContinuous();Handler.drain();activity.permission=0;bridge.onPermissionResult(2002,new int[]{0});
          check(all.isEmpty(),"late permission result cannot undo stop");

          setup(true);bridge.startContinuous();Handler.drain();old=latest();bridge.onWebMicrophoneChanged(true);bridge.listen();Handler.drain();
          check(old.stopped&&all.size()==1,"web recorder exclusively owns mic");
          bridge.onWebMicrophoneChanged(false);bridge.listen();Handler.drain();check(all.size()==2,"mic available after track ends");
          bridge.onPause();bridge.onResume();Handler.advance(10000);check(all.size()==2,"foreground return stays idle");
          bridge.onWebMicrophoneChanged(true);bridge.onPause();bridge.setWebMicrophoneInUse(false);Handler.drain();bridge.onResume();bridge.listen();Handler.drain();
          check(all.size()==3,"late track release after pause clears ownership");

          setup(true);Build.VERSION.SDK_INT=23;bridge.listen();Handler.drain();check(all.size()==1,"embedded engine works without API 31 recognizer");
          setup(true);activity.trusted=false;bridge.listen();bridge.speak("untrusted");Handler.drain();check(all.isEmpty()&&TextToSpeech.last.texts.isEmpty(),"untrusted page cannot activate voice");

          setup(false);bridge.speak("destroyed");Handler.drain();TextToSpeech engine=TextToSpeech.last;bridge.destroy();engine.init.onInit(0);Handler.drain();Handler.advance(60000);
          check(engine.shutdown&&engine.texts.isEmpty()&&activity.events.isEmpty(),"destroy invalidates late engine callback");
          System.out.println("Native speech lifecycle scenarios passed");
        }
      }`,
    'app/lifeos/twa/WakeLifecycleTest.java': `package app.lifeos.twa;
      import android.os.*;import android.content.*;import java.util.*;import static app.lifeos.twa.EmbeddedSpeechEngine.all;
      public class WakeLifecycleTest {
        static AssistantService service;
        static void check(boolean ok,String message){if(!ok)throw new AssertionError(message);}
        static void setup(boolean enabled,boolean foreground){
          if(service!=null)service.onDestroy();Handler.reset();all.clear();Build.VERSION.SDK_INT=31;
          AssistantService.setAppForeground(foreground);service=new AssistantService();service.prefs.enabled=enabled;service.onCreate();
          check(all.isEmpty(),"service creation cannot take microphone");
        }
        static EmbeddedSpeechEngine.Session latest(){return all.get(all.size()-1);}
        public static void main(String[] args){
          setup(false,false);int result=service.onStartCommand(new Intent("start"),0,1);Handler.advance(60000);
          check(result==2&&service.stops==1&&all.isEmpty(),"wake needs opt-in, no sticky resurrection");
          setup(true,false);service.onStartCommand(new Intent("stop"),0,1);check(all.isEmpty(),"stop intent never listens");
          setup(true,false);service.permission=-1;service.onStartCommand(new Intent("start"),0,1);check(all.isEmpty(),"wake needs mic permission");

          setup(true,true);service.onStartCommand(new Intent("start"),0,1);check(all.isEmpty(),"foreground owns mic");
          AssistantService.setAppForeground(false);AssistantService.setAppForeground(false);Handler.advance(750);
          check(all.size()==1,"duplicate lifecycle transition schedules only one listen");
          EmbeddedSpeechEngine.Session old=latest();old.listener.onText("",true);check(service.stops==0,"silence is not terminal");
          old.listener.onText("unrelated phrase",true);Handler.advance(60000);
          check(all.size()==1&&!old.stopped,"wake holds one silent PCM session across phrases");
          latest().listener.onError("audio_capture_failed");Handler.advance(60000);check(all.size()==1&&service.stops==1,"capture failure stops without retry");

          setup(true,false);service.onStartCommand(new Intent("start"),0,1);old=latest();old.listener.onText("unrelated phrase",true);
          AssistantService.setAppForeground(true);Handler.advance(10000);check(all.size()==1&&old.stopped,"foreground releases service microphone");
          AssistantService.setAppForeground(false);Handler.advance(750);old=latest();service.onDestroy();old.listener.onText("unrelated phrase",true);Handler.advance(60000);
          check(all.size()==2,"destroyed service cannot resurrect from late results");

          setup(true,false);service.onStartCommand(new Intent("start"),0,1);old=latest();old.listener.onText("Hey Life OS",false);old.listener.onText("Hey LifeOS",true);Handler.advance(60000);
          check(service.stops==1&&old.stopped&&all.size()==1,"wake detection releases microphone exactly once");
          service.onDestroy();System.out.println("Wake service lifecycle scenarios passed");
        }
      }`,
  };
  try {
    const files = Object.entries(sources).map(([name, content]) => {
      const path = join(dir, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); return path;
    });
    files.push(join(native, 'SpeechBridge.java'));
    files.push(join(native, 'AssistantService.java'));
    files.push(join(native, 'SpeechText.java'));
    const compiled = spawnSync('javac', ['-d', dir, ...files], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, `${compiled.error ?? ''}\n${compiled.stdout}\n${compiled.stderr}`);
    const result = spawnSync('java', ['-cp', dir, 'app.lifeos.twa.SpeechLifecycleTest'], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Native speech lifecycle scenarios passed/);
    const wake = spawnSync('java', ['-cp', dir, 'app.lifeos.twa.WakeLifecycleTest'], { encoding: 'utf8' });
    assert.equal(wake.status, 0, `${wake.error ?? ''}\n${wake.stdout}\n${wake.stderr}`);
    assert.match(wake.stdout, /Wake service lifecycle scenarios passed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function microphoneTracker(getUserMedia) {
  const source = readFileSync(join(native, 'MainActivity.java'), 'utf8');
  const body = source.split('private void installMicrophoneTracker() {')[1].split('\n    }')[0];
  const script = [...body.matchAll(/"(?:[^"\\]|\\.)*"/g)].map(match => JSON.parse(match[0])).join('');
  const ownership = [];
  const document = { visibilityState: 'visible', addEventListener() {} };
  const window = { LifeOSSpeech: { setWebMicrophoneInUse: value => ownership.push(value) } };
  const navigator = { mediaDevices: { getUserMedia } };
  vm.runInNewContext(script, { document, window, navigator, DOMException });
  return { document, window, navigator, ownership };
}

function audioStream() {
  const listeners = {};
  const track = { readyState: 'live', stop() { this.readyState = 'ended'; }, addEventListener(name, fn) { listeners[name] = fn; } };
  return { getAudioTracks: () => [track], getTracks: () => [track], track, listeners };
}

test('WebView microphone ownership is released on track stop and rejected getUserMedia', async () => {
  const stream = audioStream();
  const tracker = microphoneTracker(async () => stream);
  await tracker.navigator.mediaDevices.getUserMedia({ audio: true });
  assert.equal(tracker.ownership.at(-1), true);
  stream.track.stop();
  assert.equal(tracker.ownership.at(-1), false);
  const denied = microphoneTracker(async () => { throw new Error('permission denied'); });
  await assert.rejects(denied.navigator.mediaDevices.getUserMedia({ audio: true }), /permission denied/);
  assert.equal(denied.ownership.at(-1), false);
});

test('late WebView getUserMedia cannot reopen microphone after lifecycle cancellation', async () => {
  let resolveCapture;
  const tracker = microphoneTracker(() => new Promise(resolve => { resolveCapture = resolve; }));
  const capture = tracker.navigator.mediaDevices.getUserMedia({ audio: true });
  tracker.window.__lifeosReleaseMicrophone();
  const stream = audioStream();
  resolveCapture(stream);
  await assert.rejects(capture, /Capture cancelled/);
  assert.equal(stream.track.readyState, 'ended');
  assert.equal(tracker.ownership.at(-1), false);
});
