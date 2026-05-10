/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as bans from "../bans.js";
import type * as constants from "../constants.js";
import type * as crons from "../crons.js";
import type * as deckProxy from "../deckProxy.js";
import type * as decks from "../decks.js";
import type * as env from "../env.js";
import type * as errors from "../errors.js";
import type * as gameEvents from "../gameEvents.js";
import type * as http from "../http.js";
import type * as playerResources from "../playerResources.js";
import type * as players from "../players.js";
import type * as previewAuth from "../previewAuth.js";
import type * as previewLogin from "../previewLogin.js";
import type * as rooms from "../rooms.js";
import type * as signals from "../signals.js";
import type * as trackedCards from "../trackedCards.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  bans: typeof bans;
  constants: typeof constants;
  crons: typeof crons;
  deckProxy: typeof deckProxy;
  decks: typeof decks;
  env: typeof env;
  errors: typeof errors;
  gameEvents: typeof gameEvents;
  http: typeof http;
  playerResources: typeof playerResources;
  players: typeof players;
  previewAuth: typeof previewAuth;
  previewLogin: typeof previewLogin;
  rooms: typeof rooms;
  signals: typeof signals;
  trackedCards: typeof trackedCards;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
