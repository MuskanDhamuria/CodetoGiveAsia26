export type StoredParticipant = {
  participantId: number;
  name: string;
  contactNumber: string | null;
  email: string | null;
};

const STORAGE_KEY = "p2s.participant";

export function getStoredParticipant(): StoredParticipant | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.participantId !== "number") return null;
    return parsed as StoredParticipant;
  } catch {
    return null;
  }
}

export function storeParticipant(participant: StoredParticipant): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(participant));
}

export function clearStoredParticipant(): void {
  localStorage.removeItem(STORAGE_KEY);
}
