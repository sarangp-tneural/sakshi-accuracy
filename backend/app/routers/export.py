import csv
import io

from fastapi import APIRouter, Depends, Response
from openpyxl import Workbook
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import current_user, get_video
from ..models import Mark, MarkingType, User
from .sakshi import comparison_for

router = APIRouter(tags=["export"])


def _rows(db: Session, video_id: int):
    marks = db.scalars(select(Mark).where(Mark.video_id == video_id).order_by(Mark.time_s, Mark.id)).all()
    labels = {t.id: t.label for t in db.scalars(select(MarkingType).where(MarkingType.id.in_(
        {m.marking_type_id for m in marks if m.marking_type_id is not None})))} if marks else {}
    mark_rows = [[m.id, round(m.time_s, 3), labels.get(m.marking_type_id, ""), m.direction or "",
                  "" if m.x is None else round(m.x, 4), "" if m.y is None else round(m.y, 4),
                  m.created_at.isoformat()] for m in marks]
    cmp = comparison_for(db, video_id)
    cmp_rows = []
    for k, c in [("in", cmp["in"]), ("out", cmp["out"]), ("total", cmp["total"])] + [(t["label"], t) for t in cmp["types"]]:
        cmp_rows.append([k, c["manual"], "" if c["sakshi"] is None else c["sakshi"],
                         "" if c["diff"] is None else c["diff"],
                         "" if c["percent"] is None else c["percent"], c["status"]])
    return mark_rows, cmp_rows


MARK_HEAD = ["id", "time_s", "marking", "direction", "x", "y", "created_at"]
CMP_HEAD = ["metric", "manual", "sakshi", "difference", "difference_percent", "status"]


def _safe(cell):
    """Neutralise spreadsheet formula injection."""
    return "'" + cell if isinstance(cell, str) and cell[:1] in "=+-@\t\r" else cell


@router.get("/videos/{video_id}/export.csv")
def export_csv(video_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_video(db, user, video_id)
    marks, cmp = _rows(db, video_id)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["# comparison"])
    w.writerow(CMP_HEAD)
    w.writerows(cmp)
    w.writerow([])
    w.writerow(["# marks"])
    w.writerow(MARK_HEAD)
    w.writerows(marks)
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": f'attachment; filename="video-{video_id}.csv"'})


@router.get("/videos/{video_id}/export.xlsx")
def export_xlsx(video_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)):
    get_video(db, user, video_id)
    marks, cmp = _rows(db, video_id)
    wb = Workbook()
    ws = wb.active
    ws.title = "Comparison"
    ws.append(CMP_HEAD)
    for r in cmp:
        ws.append([_safe(c) for c in r])
    ws2 = wb.create_sheet("Marks")
    ws2.append(MARK_HEAD)
    for r in marks:
        ws2.append([_safe(c) for c in r])
    buf = io.BytesIO()
    wb.save(buf)
    return Response(buf.getvalue(),
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="video-{video_id}.xlsx"'})
