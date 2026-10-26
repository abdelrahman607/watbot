import { handleInternalConnect } from '@/lib/internal-whatsapp';

export async function POST(request: Request) {
  return handleInternalConnect(request);
}
