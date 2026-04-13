import { SessionPresenter } from "../../../components/session-presenter";

export default async function PresenterPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;

  return <SessionPresenter sessionId={sessionId} />;
}
