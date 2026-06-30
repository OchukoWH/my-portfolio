---
title: "Cluster Autoscaler Lab"
description: "A lab environment for understanding Kubernetes scheduling pressure and node autoscaling behavior."
date: "2026-05-28"
status: "Planned"
featured: false
github: ""
demo: ""
cover: ""
tags: "Kubernetes, AWS, Terraform"
stack: "Kubernetes, AWS, Terraform, Observability"
published: true
---

## Overview

Cluster Autoscaler Lab is a project for testing how pending pods, node groups, taints, requests, and scheduling constraints affect autoscaling decisions.

## Motivation

Autoscaling is often treated as a checkbox, but the behavior depends on workload requests, node capacity, cloud provider limits, and scheduler signals. This lab makes those interactions visible.

## Architecture

```mermaid
flowchart LR
  PendingPods[Pending Pods] --> Scheduler[Scheduler]
  Scheduler --> Autoscaler[Cluster Autoscaler]
  Autoscaler --> Cloud[AWS Auto Scaling Group]
  Cloud --> Nodes[Worker Nodes]
```

## Design decisions

- Use Terraform to keep the AWS environment reproducible.
- Keep workload fixtures small and easy to change.
- Capture scheduler and autoscaler logs for each scenario.
- Test both scale-up and scale-down behavior.

## Challenges

Autoscaling bugs are frequently configuration bugs. Resource requests, topology constraints, taints, and max node group size can all produce similar symptoms.

## Lessons learned

The fastest way to debug autoscaling is to compare what the scheduler cannot place with what the autoscaler is allowed to create.

## Screenshots

![Cluster autoscaler placeholder](/opengraph-image.png)

## Future improvements

- Add scenario-based runbooks.
- Compare managed node groups and self-managed groups.
- Add Grafana dashboard examples.
- Publish Terraform modules for the lab.
