import { handleInternalListContacts } from '@/lib/internal-whatsapp';

export async function GET(request: Request) {
  return handleInternalListContacts(request);
}
