import { memo } from 'react';

import { Stepper } from './Stepper';

interface Props {
  value: number;
  onChange: (thresholdRpm: number) => void;
  disabled?: boolean;
}

/** Shift threshold: tap ±100 RPM, long press ±500 RPM. Saved by the caller. */
export const ThresholdControl = memo(function ThresholdControl({
  value,
  onChange,
  disabled,
}: Props) {
  return (
    <Stepper
      label="Shift at"
      value={value}
      unit="RPM"
      step={100}
      longStep={500}
      onChange={onChange}
      disabled={disabled}
    />
  );
});
