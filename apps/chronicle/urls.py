from django.urls import path
from rest_framework.routers import DefaultRouter

from apps.chronicle.views import ChronicleViewSet, JournalCommentsView

router = DefaultRouter(trailing_slash=True)
router.register("chronicle", ChronicleViewSet, basename="chronicle")

urlpatterns = [
    path("chronicle/entries/<int:entry_id>/comments/", JournalCommentsView.as_view()),
] + router.urls
