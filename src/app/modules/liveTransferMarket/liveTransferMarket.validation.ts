import { z } from 'zod';

const joinMarketZodSchema = z.object({
  body: z.object({
    playerId: z.string().optional(),
    preferredPositions: z.array(z.string()).optional(),
    notes: z.string().optional(),
  }),
});

const requestTransferZodSchema = z.object({
  body: z.object({
    player: z.string().min(1, { message: 'Player ID is required' }),
    toTeam: z.string().min(1, { message: 'Target team ID is required' }),
    note: z.string().optional(),
  }),
});

const respondTransferZodSchema = z.object({
  body: z.object({
    action: z.enum(['APPROVE', 'REJECT']),
    reason: z.string().optional(),
  }),
});

export const LiveTransferMarketValidation = {
  joinMarketZodSchema,
  requestTransferZodSchema,
  respondTransferZodSchema,
};
