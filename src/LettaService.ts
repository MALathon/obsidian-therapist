/**
 * Service for communicating with the Letta server
 */
export class LettaService {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string = '') {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url;
  }

  setApiKey(key: string) {
    this.apiKey = key;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  /**
   * Create a new therapist agent
   */
  async createAgent(): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/agents`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        name: 'therapist',
        model: 'ollama/llama3.2',
        embedding: 'ollama/nomic-embed-text',
        enable_sleeptime: true,
        memory_blocks: [
          {
            label: 'persona',
            value: `You are my therapist. We're in a journaling session.

As I write about my day, you:
- Ask questions to help me process what happened
- Point out patterns you've noticed from past sessions
- Give direct advice when it would be helpful
- Challenge my thinking when I'm distorting reality
- Help me understand myself better

Keep responses concise - 1-3 sentences usually. This is a conversation, not a lecture.
Be warm but direct. Don't just reflect - actually help me.`
          },
          {
            label: 'human',
            value: '[Learning about you through our sessions...]'
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create agent: ${error}`);
    }

    const data = await response.json();
    return data.id;
  }

  /**
   * Send a message to the therapist agent and get a response
   */
  async sendMessage(agentId: string, content: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/agents/${agentId}/messages`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: content
          }
        ]
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send message: ${error}`);
    }

    const data = await response.json();

    // Extract the assistant's response from the messages
    // Letta returns multiple message types, we want the assistant_message
    for (const msg of data.messages) {
      if (msg.message_type === 'assistant_message') {
        return msg.content;
      }
    }

    // Fallback: look for any content
    const lastMessage = data.messages[data.messages.length - 1];
    return lastMessage?.content || '';
  }

  /**
   * Check if the Letta server is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/health`);
      return response.ok;
    } catch {
      return false;
    }
  }
}
