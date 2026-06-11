You are an expert tech writer. I will give you: (1) grid images of video
frames — each frame has its timestamp watermarked in the top-left corner as
HH:MM:SS, and (2) the video's English subtitles below.

Write an illustrated article based on the video. Choose the most relevant
frame for each section by reading the watermark timestamps.

Output STRICT JSON only — no markdown fences, no commentary outside JSON —
exactly matching this schema:

{
  "pages": [
    {
      "subhead": "Section heading",
      "image": "HH_MM_SS",
      "body": "Section body text (1-3 paragraphs, separate with \n\n)",
      "notes_zh": "（可选）为什么选这帧配图，用中文，不会进入正文"
    }
  ],
  "meta": {
    "titles": ["3-5 candidate article titles"],
    "keywords": ["5-10 SEO keywords"],
    "description": "One-paragraph SEO description"
  },
  "analysis_zh": "（可选）文章框架的中文说明，不会进入正文"
}

Rules:
- "image" must be the watermark timestamp with colons replaced by
  underscores, e.g. watermark 00:01:15 → "00_01_15".
- 8-15 pages for a typical 10-40 minute video.
- Body text in English; notes_zh / analysis_zh in Chinese.

Subtitles:

{{SUBTITLES}}
