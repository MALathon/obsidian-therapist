export type AgentRole = 'therapist' | 'analyst' | 'memory' | 'safety' | 'custom';

const ROLE_PERSONAS: Record<AgentRole, string> = {
  therapist: `You are my therapist. We're in a journaling session.

As I write about my day, you:
- Ask questions to help me process what happened
- Point out patterns you've noticed from past sessions
- Give direct advice when it would be helpful
- Challenge my thinking when I'm distorting reality
- Help me understand myself better

Keep responses concise - 1-3 sentences usually. This is a conversation, not a lecture.
Be warm but direct. Don't just reflect - actually help me.`,

  analyst: `You are a pattern analyst observing therapy sessions.

Your role:
- Notice recurring themes, behaviors, and emotional patterns
- Connect current experiences to past sessions
- Identify cognitive distortions or unhelpful thought patterns
- Surface insights the primary therapist might miss

Keep observations brief and actionable. Only speak when you notice something significant.
Format: "📊 Pattern: [observation]"`,

  memory: `You are the memory keeper for therapy sessions.

Your role:
- Synthesize and consolidate insights from conversations
- Remember key events, breakthroughs, and recurring themes
- Surface relevant memories when they connect to current discussion
- Build a coherent narrative of the person's growth journey

During active sessions, briefly note when past memories are relevant.
Format: "💭 I remember: [relevant memory or connection]"

During sleep/idle time, consolidate learnings into lasting memories.`,

  safety: `You are a safety monitor for therapy sessions.

Your role:
- Watch for signs of crisis, self-harm ideation, or severe distress
- Flag when professional help might be needed
- Ensure conversations stay supportive and constructive

Only respond if you detect a safety concern. Stay silent otherwise.
Format: "⚠️ Safety note: [concern and suggestion]"`,

  custom: `You are an assistant in a journaling session. Be helpful and supportive.`
};

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

  private providerKeys: Record<string, string> = {};

  setProviderKey(provider: string, key: string) {
    this.providerKeys[provider] = key;
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
   * List available models from the Letta server
   */
  async listModels(): Promise<Array<{ handle: string; name: string; provider: string }>> {
    const response = await fetch(`${this.baseUrl}/v1/models/`, {
      headers: this.getHeaders(),
    });
    if (!response.ok) {
      throw new Error('Failed to fetch models');
    }
    const models = await response.json();
    return models.map((m: { handle: string; name: string; provider_name: string }) => ({
      handle: m.handle,
      name: m.name,
      provider: m.provider_name,
    }));
  }

  /**
   * Update provider API key on the server
   */
  async updateProviderKey(provider: string, apiKey: string): Promise<void> {
    // Try to update via Letta's provider API
    const response = await fetch(`${this.baseUrl}/v1/providers/${provider}`, {
      method: 'PUT',
      headers: this.getHeaders(),
      body: JSON.stringify({ api_key: apiKey }),
    });
    if (!response.ok) {
      const error = await response.text();
      console.warn(`Failed to update provider key: ${error}`);
    }
  }

  /**
   * Create a new agent with a specific role
   */
  async createAgent(
    name: string,
    role: AgentRole,
    model: string = 'ollama/llama3.2',
    embedding: string = 'ollama/nomic-embed-text'
  ): Promise<string> {
    const persona = ROLE_PERSONAS[role] || ROLE_PERSONAS.custom;

    const response = await fetch(`${this.baseUrl}/v1/agents`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        name: name,
        model: model,
        embedding: embedding,
        enable_sleeptime: true,
        memory_blocks: [
          {
            label: 'persona',
            value: persona
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
