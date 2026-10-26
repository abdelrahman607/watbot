import { handleInternalCreateGroup } from '@/lib/internal-whatsapp';

export async function POST(request: Request) {
  return handleInternalCreateGroup(request);
}
