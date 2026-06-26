const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

export class GroqSttGateway {
  constructor(
    private readonly apiKey: string,
    private readonly model = "whisper-large-v3",
  ) {}

  async transcribe(file: Blob): Promise<string> {
    const form = new FormData();
    form.append("file", file, "audio.webm");
    form.append("model", this.model);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.text as string;
  }
}
