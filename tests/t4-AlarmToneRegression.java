import app.lifeos.twa.AlarmTone;
import java.util.Arrays;
import java.util.HashSet;

/** Dependency-free JVM regression; run with assertions enabled. */
class T4AlarmToneRegression {
    public static void main(String[] args) {
        String[] sounds = {"chime", "birdsong", "marimba", "sunrise", "pulse", "digital"};
        HashSet<Integer> fingerprints = new HashSet<>();
        for (String sound : sounds) {
            short[] samples = AlarmTone.samples(sound);
            assert samples.length == AlarmTone.SAMPLE_RATE * 6 / 5 : "loop duration";
            long energy = 0;
            for (short sample : samples) energy += (long) sample * sample;
            assert energy > 1000000 : sound + " must be audible";
            assert fingerprints.add(Arrays.hashCode(samples)) : sound + " was replaced by another sound";
            // Every pattern decays to silence before the loop boundary.
            for (int i = samples.length - 100; i < samples.length; i++) assert samples[i] == 0 : "loop click";
        }
        for (short sample : AlarmTone.samples("none")) assert sample == 0 : "silent selection played audio";
        assert Arrays.equals(AlarmTone.samples("chime"), AlarmTone.samples(null)) : "default chime";
        System.out.println("T4: six distinct audible melodies, silent choice and loop boundaries passed");
    }
}
