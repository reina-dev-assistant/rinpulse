import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { stepGoalOf, type StepGoal } from '@/features/today/stepGoal';
import { HuaweiWear } from '@/wear';

function readGoal(): StepGoal {
  return stepGoalOf(HuaweiWear.getUserProfile()?.dailyStepGoal);
}

/** The daily step goal from the saved profile, re-read whenever the screen gains focus. */
export function useStepGoal(): StepGoal {
  const [goal, setGoal] = useState(readGoal);
  useFocusEffect(
    useCallback(() => {
      setGoal((prev) => {
        const next = readGoal();
        return prev.goal === next.goal && prev.isDefault === next.isDefault ? prev : next;
      });
    }, []),
  );
  return goal;
}
