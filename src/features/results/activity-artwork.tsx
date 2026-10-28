import type { Activity } from "../../data/activities";
import { getActivityArtworkDataUrl } from "./activity-artwork-data";

export function ActivityArtwork({ activity, className = "" }: { readonly activity: Activity; readonly className?: string }) {
  return <img className={className} src={getActivityArtworkDataUrl(activity)} alt="" aria-hidden="true" draggable="false" />;
}
