import image_neon_night from "./assets/neon-night.svg";
import image_private_cinema from "./assets/private-cinema.svg";
import image_karaoke from "./assets/karaoke.svg";
import image_mystery_night from "./assets/mystery-night.svg";
import image_surprise_kitchen from "./assets/surprise-kitchen.svg";
import image_game_night from "./assets/game-night.svg";
import image_dance_and_lights from "./assets/dance-and-lights.svg";

/** Only bundled presentation assets live here; editable content comes from the API. */
export const bundledPartyArtwork: Readonly<Record<string, string>> = {
  "neon-night": image_neon_night,
  "private-cinema": image_private_cinema,
  karaoke: image_karaoke,
  "mystery-night": image_mystery_night,
  "surprise-kitchen": image_surprise_kitchen,
  "game-night": image_game_night,
  "dance-and-lights": image_dance_and_lights,
};

export interface PartyOutcome {
  readonly id: string;
  readonly title: string;
  readonly headline: string;
  readonly description: string;
  readonly alt: string;
  readonly steps: readonly string[];
  readonly artwork_key: string;
  readonly image_url: string | null;
}

export interface PartyCatalog {
  readonly selection_mode: "random" | "fixed";
  readonly scenarios: readonly PartyOutcome[];
}
