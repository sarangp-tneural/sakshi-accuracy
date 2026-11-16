"""Small SQL expressions shared by several routers."""
from sqlalchemy import or_

from .models import SakshiResult


def sakshi_has_value():
    """A Sakshi result counts as entered only if it holds at least one number (a saved blank form does not)."""
    return or_(SakshiResult.counts.isnot(None),
               SakshiResult.in_count.isnot(None), SakshiResult.out_count.isnot(None),
               SakshiResult.male_count.isnot(None), SakshiResult.female_count.isnot(None))
