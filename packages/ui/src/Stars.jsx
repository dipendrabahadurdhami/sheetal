// Stars: five stars showing a rating, or letting a person pick one.
// Where it fits: the Reviews page in the Business panel (read-only) and anywhere a rating is shown or chosen. The website still has its own copy (see CHANGES P1-FE-3).
// How it works: `value` is rounded to the nearest whole star (3.5 shows 4). Read-only it is one image with a spoken label ("3.5 out of 5 stars"); with `onPick` it is a
// group of five real buttons ("1 star" … "5 stars"), the chosen one marked, reachable by keyboard.
// Rules: the look is the pf-stars class in platform.css (gold when on); nothing else is needed. A missing or odd value shows no stars lit.
import React from "react";
import { Icon } from "@sheetal/shared/core/icons";

/** How many stars are lit for a rating: the nearest whole star, kept between 0 and 5. */
export const starsOn = (value) => Math.max(0, Math.min(5, Math.round(Number(value) || 0)));
/** The spoken label of a read-only rating. */
export const starsLabel = (value) => `${value} out of 5 stars`;
/** The spoken label of one pickable star. */
export const pickLabel = (n) => `${n} ${n === 1 ? "star" : "stars"}`;

export function Stars({ value = 0, size = 14, onPick, label }) {
  const on = starsOn(value);
  if (onPick) {
    return (
      <span className="pf-stars" role="radiogroup" aria-label={label || "Rating"}>
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" role="radio" aria-checked={i === on} aria-label={pickLabel(i)} className="pf-star-pick" onClick={() => onPick(i)}>
            <Icon name="star" size={size} className={i <= on ? "on" : ""} />
          </button>
        ))}
      </span>
    );
  }
  return (
    <span className="pf-stars" role="img" aria-label={label || starsLabel(value)}>
      {[1, 2, 3, 4, 5].map((i) => <Icon key={i} name="star" size={size} className={i <= on ? "on" : ""} />)}
    </span>
  );
}
