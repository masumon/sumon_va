# Import canonical master models so they are registered on Base.metadata
# whenever the model package is initialized (including Alembic env.py).
from app.models.customer import Customer

__all__ = ["Customer"]
