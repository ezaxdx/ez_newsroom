"use client";

import { useState, useEffect } from "react";
import { NewsItem } from "@/lib/types";
import { logEvent } from "@/lib/analytics";
import HeroCarousel from "./HeroCarousel";
import FeedBlock from "./FeedBlock";
import InsightModal from "./InsightModal";

type CategoryGroup = { label: string; items: NewsItem[] };
type HeroSlide = { category: string; item: NewsItem };

type Props = {
  heroSlides: HeroSlide[];
  categoryGroups: CategoryGroup[];
  carouselInterval?: number;
};

export default function NewsroomClient({ heroSlides, categoryGroups, carouselInterval }: Props) {
  const [activeItem, setActiveItem] = useState<NewsItem | null>(null);

  useEffect(() => {
    logEvent({ event_type: "view" });
  }, []);

  const handleOpen = (item: NewsItem) => {
    setActiveItem(item);
    logEvent({ event_type: "detail_view", news_id: item.id });
  };

  return (
    <>
      <div className="flex flex-col gap-12">
        <HeroCarousel slides={heroSlides} onOpen={handleOpen} interval={carouselInterval} />
        {categoryGroups.map((group) => (
          <FeedBlock key={group.label} label={group.label} items={group.items} onOpen={handleOpen} />
        ))}
      </div>
      <InsightModal item={activeItem} onClose={() => setActiveItem(null)} />
    </>
  );
}
