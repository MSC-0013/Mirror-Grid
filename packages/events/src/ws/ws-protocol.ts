import { z } from 'zod';

export type ClientMessage =
  | { readonly action: 'subscribe'; readonly topic: string }
  | { readonly action: 'unsubscribe'; readonly topic: string }
  | { readonly action: 'ping' };

export const ClientMessageSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('subscribe'),
    topic: z.string().min(1),
  }),
  z.object({
    action: z.literal('unsubscribe'),
    topic: z.string().min(1),
  }),
  z.object({
    action: z.literal('ping'),
  }),
]);

export type ServerMessage =
  | { readonly type: 'subscribed'; readonly topic: string }
  | { readonly type: 'unsubscribed'; readonly topic: string }
  | { readonly type: 'event'; readonly topic: string; readonly data: unknown }
  | { readonly type: 'pong' }
  | { readonly type: 'error'; readonly code: string; readonly message: string };
