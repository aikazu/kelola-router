export const CAVEMAN_PROMPTS: Record<string, string> = {
  terse: 'Be concise. Use short sentences. No filler. No preamble. Get straight to the answer.',
  ultra: 'Reply like a caveman. Few words. No politeness. Just answer.',
};

export type CavemanLevel = 'off' | 'terse' | 'ultra';
