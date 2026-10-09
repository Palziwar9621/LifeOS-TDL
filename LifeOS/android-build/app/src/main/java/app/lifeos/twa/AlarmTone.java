package app.lifeos.twa;

/** Offline PCM versions of the web alarm melodies. No network or default
 * ringtone substitution; silent remains silent. */
public final class AlarmTone {
    public static final int SAMPLE_RATE = 22050;
    public static short[] samples(String sound) {
        double[][] notes;
        int wave = 0;
        if ("none".equals(sound)) return new short[SAMPLE_RATE * 6 / 5];
        if ("birdsong".equals(sound)) notes = new double[][] {{2200,0,.10,.22},{2800,.12,.08,.18},{2400,.30,.10,.22},{3100,.42,.08,.15}};
        else if ("marimba".equals(sound)) { notes = new double[][] {{523,0,.25,.32},{659,.18,.25,.26},{784,.36,.35,.22}}; wave = 1; }
        else if ("sunrise".equals(sound)) notes = new double[][] {{392,0,.5,.18},{494,.14,.5,.18},{587,.28,.5,.18},{784,.42,.5,.18}};
        else if ("pulse".equals(sound)) { notes = new double[][] {{940,0,.09,.36},{940,.18,.09,.36}}; wave = 2; }
        else if ("digital".equals(sound)) { notes = new double[][] {{1000,0,.07,.34},{1000,.12,.07,.34},{1000,.24,.07,.34}}; wave = 3; }
        else notes = new double[][] {{880,0,.6,.30},{1320,.12,.5,.20},{1760,.24,.4,.12}};
        short[] pcm = new short[SAMPLE_RATE * 6 / 5];
        for (int i = 0; i < pcm.length; i++) {
            double value = 0;
            for (double[] n : notes) {
                double t = (double) i / SAMPLE_RATE - n[1];
                if (t < 0 || t >= n[2]) continue;
                double envelope = Math.min(1, t / .015) * Math.exp(-8 * t / n[2]);
                value += n[3] * envelope * (wave(n[0] * t, wave) + .5 * wave(n[0] * 2 * t, wave) + .35 * wave(n[0] * .5 * t, 3));
            }
            pcm[i] = (short) (Math.max(-1, Math.min(1, value * 2.2)) * 32767);
        }
        return pcm;
    }
    private static double wave(double cycles, int type) {
        double phase = cycles - Math.floor(cycles);
        if (type == 1) return 1 - 4 * Math.abs(phase - .5);
        if (type == 2) return phase < .5 ? 1 : -1;
        if (type == 3) return phase * 2 - 1;
        return Math.sin(2 * Math.PI * phase);
    }
    private AlarmTone() { }
}
