import {
  handleInternalAddGroupParticipants,
  handleInternalRemoveGroupParticipants,
} from '@/lib/internal-whatsapp';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params;
  return handleInternalAddGroupParticipants(request, groupId);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ groupId: string }> },
) {
  const { groupId } = await params;
  return handleInternalRemoveGroupParticipants(request, groupId);
}
