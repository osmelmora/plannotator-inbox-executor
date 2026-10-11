/** Modified for plannotator-inbox-executor. Original Plannotator attribution and
 * license are retained; adaptation details: docs/ui-fork-changes.md and UPSTREAM.json. */
/**
 * A guided review at the foot of the message that carries it (the record's
 * 4.1): like any attachment, with its sections, files and line counts, and
 * Open, which takes the window with Plannotator's guide viewer.
 */

import type { InboxGuideRef } from "../../core/inbox-types.js";
import { plural } from "../format.js";
import { Icon } from "../icons.js";

export function GuideCard({ guide, onOpen }: { guide: InboxGuideRef; onOpen: () => void }) {
  return (
    <>
      <div className="ib-attach-h">
        <Icon name="clip" size={13} />1 attachment
      </div>
      <div className="ib-atts">
        <button type="button" className="ib-att-t ib-guide" onClick={onOpen} data-guide-card="">
          <span className="ib-fi">
            <Icon name="book" size={18} />
          </span>
          <span className="ib-att-text">
            <span className="ib-nm">Guided review: {guide.title}</span>
            <span className="ib-kd">
              {plural(guide.sections, 'section')}, {plural(guide.files, 'file')}, <span className="ib-add">+{guide.additions}</span>{' '}
              <span className="ib-del">-{guide.deletions}</span>
            </span>
          </span>
          <span className="ib-open">Open</span>
        </button>
      </div>
    </>
  );
}
