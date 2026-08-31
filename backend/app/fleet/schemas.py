import uuid

from pydantic import BaseModel, ConfigDict

from app.shared.enums import VehicleStatus


class ACRISSFeatures(BaseModel):
    transmission: str
    air_conditioning: bool
    bluetooth: bool
    passenger_capacity: int
    trunk_capacity_l: int


class ACRISSCategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    name: str
    hierarchy_order: int
    base_daily_rate: float
    features: ACRISSFeatures


class VehicleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    plate: str
    make: str
    model: str
    year: int
    acriss_category_id: uuid.UUID
    branch_id: uuid.UUID
    status: VehicleStatus
    current_km: int
    next_service_km: int
    damage_count: int
    main_photo_url: str | None = None
