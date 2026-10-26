import { handleInternalListGroups } from '@/lib/internal-whatsapp';

export async function GET(request: Request) {
  return handleInternalListGroups(request);
}
