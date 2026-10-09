package app.lifeos.twa;

import java.util.Locale;

/** Conservative text-level echo guard, not speaker identification. */
final class SpeechText {
    private SpeechText() {}

    static String normalize(String text) {
        return text == null ? "" : text.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9 ]", " ").replaceAll("\\s+", " ").trim();
    }

    static String wakeSpelling(String text) {
        return text.replaceAll("(?i)\\b(hey|hello) life (?:o s|oh s|oh es|os)\\b", "$1 lifeos");
    }

    static boolean accept(String text, String playback, boolean outputActive, boolean echoTail) {
        String candidate = normalize(text);
        if (candidate.isEmpty()) return false;
        if (outputActive || echoTail) {
            String reference = normalize(playback);
            // Exact phrase/partial and substantial token overlap are likely the
            // device reading its own reply. Favor avoiding self-interruption.
            if (!reference.isEmpty() && (" " + reference + " ").contains(" " + candidate + " ")) return false;
            if (!reference.isEmpty() && candidate.split(" ").length >= 3) {
                int shared = 0;
                String[] words = candidate.split(" ");
                for (String word : words) if ((" " + reference + " ").contains(" " + word + " ")) shared++;
                if (shared * 4 >= words.length * 3) return false;
            }
        }
        // While output is audible, only a recognizable interruption prefix is
        // trusted. Arbitrary new commands can follow the wake/interrupt phrase.
        return !outputActive || candidate.matches("(?:please )?(?:stop|cancel|wait|hold on|never mind|nevermind|hey lifeos|hello lifeos)(?: .*|$)");
    }
}
