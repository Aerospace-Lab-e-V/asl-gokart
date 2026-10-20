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

// Custom pointer for the Hue slider
const HuePointer = () => (
  <div className="h-6 w-6 -ml-3 rounded-full border-2 border-primary bg-background shadow-md transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2" />
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
    <div className={cn("relative h-6 w-full rounded-full overflow-hidden border border-border/50 shadow-inner", className)}>
      <Hue
        {...({ hsl } as any)}
        onChange={handleChange}
        pointer={HuePointer}
      />
    </div>
  );
};

export const ColorPicker = CustomPicker(ColorPickerBase);
