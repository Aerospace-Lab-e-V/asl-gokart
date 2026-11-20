import React from 'react';
import { CustomPicker, InjectedColorProps, ColorChangeHandler } from 'react-color';
import { Hue } from 'react-color/lib/components/common';
import { cn } from '@/lib/utils';
import { ColorPickerProps } from './color-picker.types';

interface HSVColor {
  h: number;
  s: number;
  v: number;
  a?: number;
}

interface CustomInjectedProps extends InjectedColorProps {
  hsv?: HSVColor;
}

// Custom pointer for the Hue slider: a cursor as tall as the bar, hollow so the colour under it shows.
const HuePointer = () => (
  <div className="h-10 w-3 -ml-1.5 rounded-full border-[3px] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_1px_4px_rgba(0,0,0,0.5)]" />
);

const ColorPickerBase: React.FC<CustomInjectedProps & ColorPickerProps> = ({ 
  hsl, 
  onChange, 
  className 
}) => {
  const handleChange: ColorChangeHandler = (color) => {
    if (onChange) {
      onChange(color as any);
    }
  };

  return (
    <div className={cn("relative h-10 w-full rounded-full border border-border/50 shadow-inner", className)}>
      <Hue
        {...({ hsl } as any)}
        onChange={handleChange}
        pointer={HuePointer}
        radius="9999px"
      />
    </div>
  );
};

export const ColorPicker = CustomPicker(ColorPickerBase);
