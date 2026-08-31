"""Enum types shared across domain packages, mapped to native Postgres enums."""
import enum

from sqlalchemy import Enum as SqlEnum


def pg_enum(enum_cls: type[enum.Enum], name: str) -> SqlEnum:
    """A SqlAlchemy Enum column type that stores `.value`, not `.name`.

    SQLAlchemy's Enum type sends the Python member *name* (e.g. "AVAILABLE")
    to the DB by default, not `.value` ("Available") — wrong for every enum
    here, since member names are uppercase snake_case but the Postgres enum
    labels (and the JSON/API representation) use the CLAUDE.md-specified
    values. values_callable fixes that.
    """
    return SqlEnum(enum_cls, name=name, values_callable=lambda obj: [e.value for e in obj])


class TransmissionType(str, enum.Enum):
    MANUAL = "manual"
    AUTOMATIC = "automatic"


class VehicleStatus(str, enum.Enum):
    AVAILABLE = "Available"
    RENTED = "Rented"
    IN_PREP = "InPrep"
    INACTIVE = "Inactive"


class ReservationStatus(str, enum.Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    COMPLETED = "completed"
    NO_SHOW = "no_show"


class ContractOrigin(str, enum.Enum):
    FROM_RESERVATION = "from_reservation"
    WALK_IN = "walk_in"


class ContractStatus(str, enum.Enum):
    NEW = "New"
    PRE_OPENED = "PreOpened"
    OPEN = "Open"


class DepositMechanism(str, enum.Enum):
    ONLINE_IN_ADVANCE = "online_in_advance"
    IN_PERSON = "in_person"


class DepositStatus(str, enum.Enum):
    PENDING = "pending"
    AUTHORIZED = "authorized"


class SignatureType(str, enum.Enum):
    CONTRACT = "contract"
    HANDOVER_REPORT = "handover_report"


class HandoverReportStatus(str, enum.Enum):
    PENDING = "pending"
    COMPLETED = "completed"
