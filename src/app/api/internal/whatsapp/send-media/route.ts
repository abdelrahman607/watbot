import { handleInternalSendMedia } from '@/lib/internal-whatsapp';

export async function POST(request: Request) {
  return handleInternalSendMedia(request);
}
