import { useEffect, useState, useSyncExternalStore } from 'react';

import { useCloud } from '@/state/CloudProvider';
import { byokAccess, type ByokAccess } from './access';
import { readPerson } from './data/personData';
import type { Person } from './person';
import { aiKv, aiSettings } from './stores';
import type { AiSettings } from './settings';

/** The Joyo AI settings, live. */
export function useAiSettings(): AiSettings {
  return useSyncExternalStore(aiSettings.subscribe, aiSettings.get, aiSettings.get);
}

/** Who is asking (age) as far as the phone and JoyoRogo know; null until the first read. Re-read when the sign-in changes. */
export function usePerson(): Person | null {
  const { signedIn } = useCloud();
  const [person, setPerson] = useState<Person | null>(null);
  useEffect(() => {
    let cancelled = false;
    readPerson(aiKv, signedIn).then((p) => {
      if (!cancelled) setPerson(p);
    });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);
  return person;
}

/** Whether the own-key engine may be used right now, and why not. `null` until the age is known to be read. */
export function useByokAccess(): { access: ByokAccess | null; person: Person | null; settings: AiSettings } {
  const settings = useAiSettings();
  const person = usePerson();
  return { access: person ? byokAccess(settings, person.ageYears) : null, person, settings };
}
