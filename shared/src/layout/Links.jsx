// Small link chips that move people between related records without the sidebar.

import React from "react";
import { Link } from "../core/router";
import { Icon } from "../core/icons";

export const IconLink = ({ to, icon, label }) => (
  <Link to={to} className="btn btn-ghost btn-icon pf-icon-link" aria-label={label} title={label} onClick={(e) => e.stopPropagation()}><Icon name={icon} size={16} /></Link>
);
export const LinkChip = ({ to, icon, children }) => (
  <Link to={to} className="chip pf-link-chip"><Icon name={icon} size={14} />{children}<Icon name="arrow-up-right" size={13} /></Link>
);
