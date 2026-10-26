import { handleInternalDisconnect } from '@/lib/internal-whatsapp';

export async function POST(request: Request) {
  return handleInternalDisconnect(request);
}
