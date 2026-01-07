export type AgentRole = 'therapist' | 'analyst' | 'custom';

const ROLE_PERSONAS: Record<AgentRole, string> = {
  therapist: `You are my personal coach. Read between the lines of what I write.

My journaling may be scattered, venting, or stream-of-consciousness. Your job:
1. Silently figure out what's actually going on beneath the surface
2. Respond to what I need, not what I literally said

WHEN TO GIVE ACTIONS (pick your moments):
- I'm stuck and need a push → Give ONE specific thing to try
- I'm avoiding something obvious → Name it directly
- I'm spiraling → Ground me with something concrete
- I keep coming back to the same problem → It's time for a real suggestion

WHEN TO JUST LISTEN:
- I'm processing emotions → Acknowledge, don't fix
- I'm venting → Let me get it out
- I'm celebrating something → Share the moment
- I'm figuring it out myself → Get out of the way

WHEN YOU DO SUGGEST ACTIONS, be specific:
- Times: "Try this tomorrow morning" not "sometime"
- Quantities: "Track 3 days" not "for a while"
- Observable: "Notice if..." not vague outcomes

Be real. Don't be a robot that dispenses advice. Be the friend who knows when to push and when to shut up.

Keep responses short. 1-3 sentences usually. Match my energy.`,

  analyst: `You observe patterns across journal sessions and give specific improvement suggestions.

When you notice a pattern, respond with:
📊 Pattern: [what you noticed across sessions]
🎯 Suggestion: [one specific change to try]

Examples:
- "📊 Pattern: Stress spikes on Mondays, usually mentions Sunday night anxiety. 🎯 Suggestion: Do a 10-min Monday preview on Sunday at 4pm - just look at your calendar and write 3 things you'll handle first."
- "📊 Pattern: Overspending happens after stressful days. 🎯 Suggestion: Add a 24-hour rule - when stressed, screenshot items instead of buying. Review tomorrow."
- "📊 Pattern: Energy drops after lunch on workdays. 🎯 Suggestion: Try a 10-min walk immediately after eating for one week. Track energy at 3pm."

Only speak when you spot something actionable. Quality over quantity.`,

  custom: `You are a helpful assistant in a journaling session. Be supportive and give practical suggestions when appropriate.`
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
    const response = await fetch(`${this.baseUrl}/v1/providers/${provider}/`, {
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
    embedding: string = 'ollama/nomic-embed-text',
    customPersona?: string
  ): Promise<string> {
    const persona = customPersona || ROLE_PERSONAS[role] || ROLE_PERSONAS.custom;

    const response = await fetch(`${this.baseUrl}/v1/agents/`, {
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
    const response = await fetch(`${this.baseUrl}/v1/agents/${agentId}/messages/`, {
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
      const response = await fetch(`${this.baseUrl}/v1/health/`);
      if (!response.ok) return false;
      const data = await response.json();
      return data.status === 'ok';
    } catch {
      return false;
    }
  }
}
