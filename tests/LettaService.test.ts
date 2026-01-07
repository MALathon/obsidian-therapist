import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LettaService } from '../src/LettaService';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('LettaService', () => {
  let service: LettaService;

  beforeEach(() => {
    service = new LettaService('http://localhost:8283');
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('sets the base URL', () => {
      const customService = new LettaService('http://custom:9000');
      // We can't directly test private property, but we can test behavior
      expect(customService).toBeDefined();
    });
  });

  describe('setBaseUrl', () => {
    it('updates the base URL', () => {
      service.setBaseUrl('http://newurl:1234');
      // Verify by making a request and checking the URL
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'test' })
      });

      service.createAgent('therapist', 'therapist');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://newurl:1234/v1/agents/',
        expect.any(Object)
      );
    });
  });

  describe('createAgent', () => {
    it('creates an agent and returns the ID', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'agent-123' })
      });

      const agentId = await service.createAgent('therapist', 'therapist');

      expect(agentId).toBe('agent-123');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8283/v1/agents/',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.any(String)
        })
      );
    });

    it('includes correct memory blocks in request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'agent-123' })
      });

      await service.createAgent('therapist', 'therapist');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);

      expect(body.name).toBe('therapist');
      expect(body.enable_sleeptime).toBe(true);
      expect(body.memory_blocks).toHaveLength(2);
      expect(body.memory_blocks[0].label).toBe('persona');
      expect(body.memory_blocks[1].label).toBe('human');
    });

    it('uses role-specific persona', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'agent-456' })
      });

      await service.createAgent('pattern-watcher', 'analyst');

      const call = mockFetch.mock.calls[0];
      const body = JSON.parse(call[1].body);

      expect(body.name).toBe('pattern-watcher');
      expect(body.memory_blocks[0].value).toContain('observe patterns');
    });

    it('throws error on failed request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Server error')
      });

      await expect(service.createAgent('test', 'therapist')).rejects.toThrow('Failed to create agent: Server error');
    });
  });

  describe('sendMessage', () => {
    it('sends message and returns assistant response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          messages: [
            { message_type: 'reasoning_message', reasoning: 'thinking...' },
            { message_type: 'assistant_message', content: 'How are you feeling?' }
          ]
        })
      });

      const response = await service.sendMessage('agent-123', 'I had a bad day');

      expect(response).toBe('How are you feeling?');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8283/v1/agents/agent-123/messages/',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('I had a bad day')
        })
      );
    });

    it('extracts assistant_message from multiple message types', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          messages: [
            { message_type: 'tool_call_message', tool_call: {} },
            { message_type: 'tool_return_message', tool_return: 'result' },
            { message_type: 'assistant_message', content: 'Based on my analysis...' }
          ]
        })
      });

      const response = await service.sendMessage('agent-123', 'test');

      expect(response).toBe('Based on my analysis...');
    });

    it('falls back to last message content if no assistant_message', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          messages: [
            { message_type: 'other', content: 'fallback content' }
          ]
        })
      });

      const response = await service.sendMessage('agent-123', 'test');

      expect(response).toBe('fallback content');
    });

    it('throws error on failed request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve('Network error')
      });

      await expect(service.sendMessage('agent-123', 'test'))
        .rejects.toThrow('Failed to send message: Network error');
    });
  });

  describe('healthCheck', () => {
    it('returns true when server is healthy', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'ok' })
      });

      const result = await service.healthCheck();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8283/v1/health/');
    });

    it('returns false when server returns error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await service.healthCheck();

      expect(result).toBe(false);
    });

    it('returns false when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const result = await service.healthCheck();

      expect(result).toBe(false);
    });
  });
});
