// =====================================================================
// Gemini AI Utility — Wrapper for Google Generative AI (FREE)
// =====================================================================
// Replaces z-ai-web-dev-sdk for CasaOS deployment where Z.ai internal
// API is not accessible.
// =====================================================================

import { GoogleGenerativeAI } from '@google/generative-ai';

let _genAI: GoogleGenerativeAI | null = null;

function getGenAI(): GoogleGenerativeAI {
  if (_genAI) return _genAI;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Please add it to your .env file.\n' +
      'Get a free key at: https://aistudio.google.com/apikey'
    );
  }

  _genAI = new GoogleGenerativeAI(apiKey);
  return _genAI;
}

/**
 * Chat completion — drop-in replacement for z-ai-web-dev-sdk chat.completions.create()
 *
 * @param options.messages - Array of { role: 'system'|'user'|'assistant', content: string }
 * @param options.model - Gemini model name (default: gemini-2.0-flash)
 * @returns { content: string }
 */
export async function chatCompletion(options: {
  messages: { role: string; content: string }[];
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}): Promise<{ content: string }> {
  const model = getGenAI().getGenerativeModel({
    model: options.model || 'gemini-2.0-flash',
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxOutputTokens ?? 8192,
    },
  });

  // Gemini uses 'system' instruction separately
  const systemMessage = options.messages.find(m => m.role === 'system');
  const conversationMessages = options.messages.filter(m => m.role !== 'system');

  // Build prompt parts from conversation history
  const history: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
  let lastUserMessage = '';

  for (const msg of conversationMessages) {
    if (msg.role === 'user') {
      lastUserMessage = msg.content;
      // Only push to history if there was a previous exchange
      if (history.length > 0 || conversationMessages.indexOf(msg) > 0) {
        history.push({ role: 'user', parts: [{ text: msg.content }] });
      }
    } else if (msg.role === 'assistant') {
      history.push({ role: 'model', parts: [{ text: msg.content }] });
    }
  }

  try {
    const chat = model.startChat({
      history,
      ...(systemMessage ? { systemInstruction: systemMessage.content } : {}),
    });

    const result = await chat.sendMessage(lastUserMessage || 'Hello');
    const response = result.response;
    const content = response.text();

    return { content };
  } catch (err: any) {
    console.error('[Gemini] chatCompletion error:', err.message || err);
    throw err;
  }
}

/**
 * Simple text generation (no conversation history)
 */
export async function generateText(options: {
  prompt: string;
  systemInstruction?: string;
  model?: string;
  temperature?: number;
}): Promise<string> {
  const model = getGenAI().getGenerativeModel({
    model: options.model || 'gemini-2.0-flash',
    generationConfig: {
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: 8192,
    },
    ...(options.systemInstruction ? { systemInstruction: options.systemInstruction } : {}),
  });

  const result = await model.generateContent(options.prompt);
  return result.response.text();
}

/**
 * Check if Gemini API is available (has API key)
 */
export function isAvailable(): boolean {
  return !!process.env.GEMINI_API_KEY;
}
