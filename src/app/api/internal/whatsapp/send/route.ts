import { handleInternalSend } from '@/lib/internal-whatsapp';

export async function POST(request: Request) {
  return handleInternalSend(request);
}
