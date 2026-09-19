'use server';

import { revalidatePath } from 'next/cache';
import {
  markWatched, markWatchedOn, markSeasonWatched, unmarkLatest, unmarkWatch,
  setStatus, setRating,
} from '@/lib/db';
import { addToLibrary } from '@/lib/tmdbApi';

// every mutation can affect the home rails and a detail page, so refresh both
const refresh = () => revalidatePath('/', 'layout');

export async function markWatchedAction(mediaId: number, episodeId: number | null) {
  await markWatched(mediaId, episodeId); refresh();
}
export async function markWatchedOnAction(mediaId: number, episodeId: number | null, day: string) {
  await markWatchedOn(mediaId, episodeId, day); refresh();
}
export async function markSeasonWatchedAction(mediaId: number, season: number) {
  const n = await markSeasonWatched(mediaId, season); refresh(); return n;
}
export async function unmarkLatestAction(mediaId: number, episodeId: number | null) {
  await unmarkLatest(mediaId, episodeId); refresh();
}
export async function unmarkWatchAction(watchId: number) {
  await unmarkWatch(watchId); refresh();
}
export async function setStatusAction(mediaId: number, status: string) {
  await setStatus(mediaId, status); refresh();
}
export async function setRatingAction(mediaId: number, rating: number | null) {
  await setRating(mediaId, rating); refresh();
}
export async function addToLibraryAction(tmdbId: number, type: 'movie' | 'show', status: string) {
  const id = await addToLibrary(tmdbId, type, status); refresh(); return id;
}
