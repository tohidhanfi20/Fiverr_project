#!/bin/bash

# Build Docker images for all microservices

set -e

REGISTRY=${ECR_REGISTRY:-"your-ecr-registry"}
AWS_REGION=${AWS_REGION:-"us-east-1"}

SERVICES=(
  "user-service"
  "course-service"
  "enrollment-service"
  "payment-service"
  "web-service"
)

echo "Building Docker images..."

for service in "${SERVICES[@]}"; do
  echo "Building $service..."
  docker build -t $service:latest ./microservices/$service
  docker tag $service:latest $REGISTRY/$service:latest
done

echo "Building analytics-service..."
docker build -t analytics-service:latest ./microservices/analytics-service
docker tag analytics-service:latest $GCR_REGISTRY/analytics-service:latest

echo "All images built successfully!"

