import { handleInternalHealth } from '@/lib/internal-whatsapp';

export async function GET(request: Request) {
  return handleInternalHealth(request);
}
