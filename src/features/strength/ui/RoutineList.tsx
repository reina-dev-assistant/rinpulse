import { StyleSheet } from 'react-native';

import { Card, Divider } from '@/components/Screen';

import type { Catalog } from '../catalog';
import type { Routine } from '../types';

import { RoutineRow } from './RoutineRow';

interface RoutineListProps {
  routines: readonly Routine[];
  catalog: Catalog;
  onOpen: (routine: Routine) => void;
  onStart: (routine: Routine) => void;
}

/** Routines in one card, a hairline between rows. */
export function RoutineList({ routines, catalog, onOpen, onStart }: RoutineListProps) {
  return (
    <Card style={styles.card}>
      {routines.map((routine, index) => (
        <RowWithDivider key={routine.id} first={index === 0}>
          <RoutineRow routine={routine} catalog={catalog} onOpen={onOpen} onStart={onStart} />
        </RowWithDivider>
      ))}
    </Card>
  );
}

function RowWithDivider({ first, children }: { first: boolean; children: React.ReactNode }) {
  return (
    <>
      {first ? null : <Divider />}
      {children}
    </>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, gap: 0, overflow: 'hidden' },
});
