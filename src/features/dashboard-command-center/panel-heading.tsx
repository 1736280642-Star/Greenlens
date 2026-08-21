import { Maximize2 } from "lucide-react";

export function CommandPanelHeading({
  eyebrow,
  title,
  detail,
  action,
  onExpand,
  expandLabel,
}: {
  eyebrow: string;
  title: string;
  detail?: string;
  action?: React.ReactNode;
  onExpand?: () => void;
  expandLabel?: string;
}) {
  return <header className="cc-panel-heading">
    <div><span>{eyebrow}</span><h3>{title}</h3></div>
    <div className="cc-panel-heading-side">
      {detail ? <small>{detail}</small> : null}
      {action}
      {onExpand ? <button className="cc-expand-button" onClick={onExpand} aria-label={expandLabel ?? `展开${title}`} title={expandLabel ?? `展开${title}`}><Maximize2/></button> : null}
    </div>
  </header>;
}
