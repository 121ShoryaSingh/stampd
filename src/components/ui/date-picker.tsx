"use client";

import { useId, useState } from "react";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/shadcn/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/shadcn/popover";
import { Label } from "@/components/shadcn/label";
import { cn } from "@/lib/utils";

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// Whole days from today to the chosen date, never less than 1.
export function daysUntil(date: Date, now = new Date()) {
  const a = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const b = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.max(1, Math.round((b - a) / DAY));
}

// shadcn Popover + Calendar, styled Neo-Brutalist; submits YYYY-MM-DD in a hidden input.
export function DatePicker({
  label,
  name,
  defaultValue,
  minDate,
  maxDate,
  onChange,
}: {
  label: string;
  name: string;
  defaultValue?: Date;
  minDate?: Date;
  maxDate?: Date;
  onChange?: (d: Date) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState<Date | undefined>(defaultValue);
  const shown = date ? format(date, "PPP") : `Enter ${label.toLowerCase()}`;

  return (
    <div>
      <Label htmlFor={id} className="mb-1 block font-mono text-xs font-bold uppercase tracking-wider">
        {label}
      </Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            aria-label={`${label}: ${shown}`}
            className={cn("border-brutal flex w-full items-center justify-between gap-2 bg-paper px-3 py-2.5 text-left font-bold outline-none hover:bg-yellow/50 focus-visible:bg-yellow", !date && "font-normal opacity-60")}
          >
            {shown}
            <CalendarDays aria-hidden className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="border-brutal shadow-hard w-auto bg-paper p-0">
          <Calendar
            mode="single"
            selected={date}
            defaultMonth={date}
            disabled={[...(minDate ? [{ before: startOfDay(minDate) }] : []), ...(maxDate ? [{ after: startOfDay(maxDate) }] : [])]}
            onSelect={(d) => {
              if (!d) return;
              setDate(d);
              setOpen(false);
              onChange?.(d);
            }}
            className="font-sans"
          />
        </PopoverContent>
      </Popover>
      <input type="hidden" name={name} value={date ? format(date, "yyyy-MM-dd") : ""} />
    </div>
  );
}
