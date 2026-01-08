import { requestUrl } from 'obsidian';

export type AgentRole = 'therapist' | 'analyst' | 'custom';

const ROLE_PERSONAS: Record<AgentRole, string> = {
  therapist: `You are my personal coach. Read between the lines of what I write.

My journaling may be scattered, venting, or stream-of-consciousness. Your job:
1. Silently figure out what's actually going on beneath the surface
2. Respond to what I need, not what I literally said

RESPONSE PROTOCOL:
- Messages prefixed with "[User is asking for your input]" → Always respond
- Messages prefixed with "[User is journaling...]" → Only respond if you have genuine insight
- If you have nothing valuable to add, respond with just: [listening]

WHEN TO RESPOND:
- I'm stuck and need a push → Give ONE specific thing to try
- I'm avoiding something obvious → Name it directly
- I'm spiraling → Ground me with something concrete
- I keep coming back to the same problem → Offer a real suggestion
- I'm asking you directly → Answer me

WHEN TO STAY SILENT (respond with [listening]):
- I'm just processing emotions
- I'm venting and don't need fixing
- I'm working through something myself
- You'd just be restating what I said

WHEN YOU DO RESPOND, be specific:
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
    const response = await requestUrl({
      url: `${this.baseUrl}/v1/models/`,
      headers: this.getHeaders(),
    });
    if (response.status !== 200) {
      throw new Error('Failed to fetch models');
    }
    const models = response.json;
    return models.map((m: { handle: string; name: string; provider_name: string }) => ({
      handle: m.handle,
      name: m.name,
      provider: m.provider_name,
    }));
  }

  /**
   * Create or update a provider with API key on the server
   */
  async updateProviderKey(provider: string, apiKey: string): Promise<void> {
    try {
      // First check if provider exists
      const existingProviders = await requestUrl({
        url: `${this.baseUrl}/v1/providers/`,
        headers: this.getHeaders(),
      });

      const providers = existingProviders.json as Array<{ id: string; name: string; provider_type: string }>;
      const existing = providers.find(p => p.provider_type === provider);

      if (existing) {
        // Update existing provider
        await requestUrl({
          url: `${this.baseUrl}/v1/providers/${existing.id}/`,
          method: 'PATCH',
          headers: this.getHeaders(),
          body: JSON.stringify({ api_key: apiKey }),
        });
      } else {
        // Create new provider
        await requestUrl({
          url: `${this.baseUrl}/v1/providers/`,
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify({
            name: provider,
            provider_type: provider,
            api_key: apiKey,
          }),
        });
      }
    } catch (error) {
      console.warn(`Failed to update provider key:`, error);
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

    const response = await requestUrl({
      url: `${this.baseUrl}/v1/agents/`,
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

    if (response.status !== 200) {
      throw new Error(`Failed to create agent: ${response.text}`);
    }

    return response.json.id;
  }

  /**
   * Send a message to the therapist agent and get a response
   */
  async sendMessage(agentId: string, content: string): Promise<string> {
    const response = await requestUrl({
      url: `${this.baseUrl}/v1/agents/${agentId}/messages/`,
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

    if (response.status !== 200) {
      throw new Error(`Failed to send message: ${response.text}`);
    }

    const data = response.json;

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
   * Delete an agent from Letta
   */
  async deleteAgent(agentId: string): Promise<void> {
    const response = await requestUrl({
      url: `${this.baseUrl}/v1/agents/${agentId}/`,
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (response.status !== 200 && response.status !== 204) {
      throw new Error(`Failed to delete agent: ${response.text}`);
    }
  }

  /**
   * Check if the Letta server is reachable
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await requestUrl({
        url: `${this.baseUrl}/v1/health/`,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Create an archive for storing vault content
   */
  async createArchive(name: string, embedding: string = 'letta/letta-free'): Promise<string> {
    const response = await requestUrl({
      url: `${this.baseUrl}/v1/archives/`,
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        name: name,
        description: 'Obsidian vault content for therapist context',
        embedding: embedding,
      }),
    });

    if (response.status !== 200) {
      throw new Error(`Failed to create archive: ${response.text}`);
    }

    return response.json.id;
  }

  /**
   * List existing archives
   */
  async listArchives(): Promise<Array<{ id: string; name: string }>> {
    const response = await requestUrl({
      url: `${this.baseUrl}/v1/archives/`,
      headers: this.getHeaders(),
    });

    if (response.status !== 200) {
      throw new Error('Failed to list archives');
    }

    return response.json.map((a: { id: string; name: string }) => ({
      id: a.id,
      name: a.name,
    }));
  }

  /**
   * Add a passage (text chunk) to an archive
   */
  async addPassage(archiveId: string, text: string, metadata: Record<string, string> = {}): Promise<void> {
    const response = await requestUrl({
      url: `${this.baseUrl}/v1/archives/${archiveId}/passages/`,
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        text: text,
        metadata: metadata,
      }),
    });

    if (response.status !== 200) {
      throw new Error(`Failed to add passage: ${response.text}`);
    }
  }

  /**
   * Attach an archive to an agent for RAG access
   */
  async attachArchive(agentId: string, archiveId: string): Promise<void> {
    const response = await requestUrl({
      url: `${this.baseUrl}/v1/agents/${agentId}/archives/attach/${archiveId}/`,
      method: 'POST',
      headers: this.getHeaders(),
    });

    if (response.status !== 200) {
      throw new Error(`Failed to attach archive: ${response.text}`);
    }
  }

  /**
   * Delete all passages from an archive (for re-indexing)
   */
  async clearArchive(archiveId: string): Promise<void> {
    // Get all passages first
    const response = await requestUrl({
      url: `${this.baseUrl}/v1/archives/${archiveId}/passages/`,
      headers: this.getHeaders(),
    });

    if (response.status !== 200) {
      return; // Archive might be empty
    }

    const passages = response.json as Array<{ id: string }>;

    // Delete each passage
    for (const passage of passages) {
      try {
        await requestUrl({
          url: `${this.baseUrl}/v1/archives/${archiveId}/passages/${passage.id}/`,
          method: 'DELETE',
          headers: this.getHeaders(),
        });
      } catch {
        // Continue even if one fails
      }
    }
  }
}
