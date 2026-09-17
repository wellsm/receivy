import { monthTabs, type MonthTab } from "@receivy/common";

type FeedMonthTabsProps = {
  month: string;
  onSelect: (month: string) => void;
};

/** The Feed's month carousel: previous, selected and next, the selected one centered and highlighted. */
export function FeedMonthTabs({ month, onSelect }: FeedMonthTabsProps) {
  const tabs: MonthTab[] = monthTabs(month);

  return (
    <div role="group" aria-label="Mês" className="-mx-5 flex border-b border-outline">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          aria-pressed={tab.selected}
          aria-current={tab.selected ? "true" : undefined}
          onClick={() => onSelect(tab.value)}
          className={`flex-1 border-b-[2.5px] py-2 text-center font-display text-[13.5px] tabular-nums ${
            tab.selected ? "border-primary font-extrabold text-ink" : "border-transparent font-semibold text-muted"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
