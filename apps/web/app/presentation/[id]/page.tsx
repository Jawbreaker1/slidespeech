import { PublishedPresenter } from "../../../components/published-presenter";

export default async function PresentationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PublishedPresenter id={id} />;
}
