---
title: "Enhancing Kubernetes Security with OPA: Practical Policies That Matter"
description: "Learn how to secure Kubernetes clusters with Open Policy Agent (OPA) Gatekeeper by enforcing namespace standards, approved image registries, and service restrictions using policy as code."
date: "2026-07-11"
tags: "Kubernetes, OPA, Gatekeeper, Rego, Admission Controller, Platform Engineering, Cloud Native, Security"
published: true
order: 2
---

Security is the foundation of every Kubernetes cluster. Misconfigurations, unapproved images, missing labels, and insecure service types can easily introduce vulnerabilities or operational risks. Modern Kubernetes environments require more than deployment automation—they need guardrails that ensure workloads consistently meet organizational standards.

With the rise of AI tools that can generate manifests instantly, platform and cluster administrators must enforce strict policies before workloads are deployed. This is where **Open Policy Agent (OPA)** and **Gatekeeper** excel. By defining policies as code, you can validate configurations early, catch risky patterns, and maintain a predictable and well-governed Kubernetes environment.

In this article, we'll walk through practical examples of using OPA Gatekeeper to enforce real-world policies, including namespace standards, image registry restrictions, and service type controls.


## 1. Understanding OPA

**Open Policy Agent (OPA)** is a general-purpose policy engine that evaluates JSON data against rules written in **Rego**.

Although OPA is widely used in Kubernetes, it is **not Kubernetes-specific**. It can enforce policies for:

- Kubernetes
- APIs
- CI/CD pipelines
- Terraform
- Microservices
- Service meshes
- Cloud infrastructure

Within Kubernetes, OPA is primarily used in two ways.

## Admission Control

Before Kubernetes creates a resource, the API server sends the manifest to OPA (through Gatekeeper).

OPA evaluates the object against your policies.

If the manifest violates a policy:

- The request is rejected.
- The object never reaches the cluster.

This is the focus of this article.


## Runtime Authorization

OPA can also make authorization decisions at runtime.

For example:

- Istio
- Envoy
- API gateways

can ask OPA whether an incoming request should be allowed.


## 2. Setting Up the Cluster

To follow along with this article, you'll need a Kubernetes lab.

The lab uses **Vagrant** to provision a single-node kubeadm cluster inside a 4 GB Ubuntu virtual machine.

Requirements:

- Vagrant
- VirtualBox
- At least **8 GB** of RAM

The cluster includes:

- Kubernetes
- containerd
- Calico
- An untainted control-plane node

Provision the lab using:

```bash
curl -s https://raw.githubusercontent.com/OchukoWH/one-node-kubeadm-cluster/refs/heads/main/scripts/setup-lab.sh | bash
```

After the setup finishes:

```bash
cd one-node-kubeadm-cluster
vagrant ssh
```


## Installing Helm

Install Helm using the official installation script.

```bash
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-4

chmod 700 get_helm.sh

./get_helm.sh
```


## Installing OPA Gatekeeper

Add the Helm repository:

```bash
helm repo add gatekeeper https://open-policy-agent.github.io/gatekeeper/charts
```

Install Gatekeeper:

```bash
helm install gatekeeper/gatekeeper \
  --name-template=gatekeeper \
  --namespace gatekeeper-system
```

If the installation succeeds, you'll see output similar to:

```text
NAME: gatekeeper
LAST DEPLOYED: Tue Nov 25 16:07:43 2025
NAMESPACE: gatekeeper-system
STATUS: deployed
REVISION: 1
DESCRIPTION: Install complete
TEST SUITE: None
```

This confirms Gatekeeper has been installed successfully.


## 3. Enforcing Policies with Gatekeeper

To make this walkthrough easier, all of the ConstraintTemplates, Constraints, and example workloads are already available in the repository below.

Clone it first.

```bash
git clone https://github.com/OchukoWH/configuring-workloads-using-opa.git

cd configuring-workloads-using-opa
```

We'll implement three common governance policies:

1. Namespace standards
2. Image registry restrictions
3. Blocking NodePort services

Each example builds on the previous one.


## 3.1 Namespace Standards

Suppose your organization requires every namespace to define:

- project
- environment
- maintainer

Instead of relying on developers to remember these labels, Gatekeeper can enforce them automatically.


## Step 1 — Create the ConstraintTemplate

`ns-k8s-required-labels.yaml`

```yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate
metadata:
  name: k8srequiredlabels

spec:
  crd:
    spec:
      names:
        kind: K8sRequiredLabels

      validation:
        openAPIV3Schema:
          type: object
          properties:
            labels:
              type: array
              items:
                type: string

  targets:
  - target: admission.k8s.gatekeeper.sh
    rego: |
      package k8srequiredlabels

      violation[{"msg": msg, "details": {"missing_labels": missing}}] {

        provided := {label |
          input.review.object.metadata.labels[label]
        }

        required := {label |
          required_labels := input.parameters.labels[_]
          label := required_labels
        }

        missing := required - provided

        count(missing) > 0

        msg := sprintf("you must provide labels: %v", [missing])
      }
```

Apply it:

```bash
kubectl apply -f ns-k8s-required-labels.yaml
```


## Step 2 — Create the Constraint

`ns-standards.yaml`

```yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredLabels

metadata:
  name: namespaces-must-have-standard-labels

spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds:
      - Namespace

    namespaces:
    - "*"

  parameters:
    labels:
    - project
    - environment
    - maintainer
```

Apply it:

```bash
kubectl apply -f ns-standards.yaml
```


## Step 3 — Test a Namespace Without Labels

```bash
kubectl create namespace marketing
```

Gatekeeper rejects it.

```text
Error from server (Forbidden):
admission webhook "validation.gatekeeper.sh" denied the request:

[namespaces-must-have-standard-labels]

you must provide labels:
{"environment","maintainer","project"}
```


## Step 4 — Create a Valid Namespace

```yaml
apiVersion: v1
kind: Namespace

metadata:
  name: marketing

  labels:
    project: cloud-platform
    environment: production
    maintainer: team-marketing
```

Apply it:

```bash
kubectl apply -f good-ns.yaml
```

The namespace is accepted because it satisfies the policy.


## 3.2 Restricting Image Registries

Organizations often require workloads to pull images only from trusted registries.

For example:

- `gcr.io`
- `ghcr.io`
- `registry.company.com`

This prevents developers from deploying arbitrary Docker Hub images.


## Step 1 — Create the ConstraintTemplate

`k8sregistry-required.yaml`

```yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate

metadata:
  name: k8srequiredregistry

spec:
  crd:
    spec:
      names:
        kind: K8sRequiredRegistry

      validation:
        openAPIV3Schema:
          type: object
          properties:
            registry:
              type: string

  targets:
  - target: admission.k8s.gatekeeper.sh
    rego: |
      package k8srequiredregistry

      violation[{"msg": msg}] {

        input.review.kind.kind == "Pod"

        required := input.parameters.registry

        container := input.review.object.spec.containers[_]

        image := container.image

        not startswith(image, required)

        msg := sprintf(
          "Forbidden registry: %v. Must start with %v",
          [image, required]
        )
      }

      violation[{"msg": msg}] {

        input.review.kind.kind != "Pod"

        pod := input.review.object.spec.template.spec

        required := input.parameters.registry

        container := pod.containers[_]

        image := container.image

        not startswith(image, required)

        msg := sprintf(
          "Forbidden registry: %v. Must start with %v",
          [image, required]
        )
      }
```

Apply it:

```bash
kubectl apply -f k8sregistry-required.yaml
```


## Step 2 — Create the Constraint

```yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: K8sRequiredRegistry

metadata:
  name: images-must-come-from-gcr

spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds:
      - Pod

    - apiGroups: ["apps"]
      kinds:
      - Deployment
      - StatefulSet
      - DaemonSet

    namespaces:
    - marketing

  parameters:
    registry: gcr.io/
```

Apply it:

```bash
kubectl apply -f images-must-come-from-gcr.yaml
```


## Step 3 — Test Invalid Workloads

Try creating:

```bash
kubectl apply -f bad-pod.yaml
```

```bash
kubectl apply -f bad-deploy.yaml
```

```bash
kubectl apply -f bad-daemonset.yaml
```

```bash
kubectl apply -f bad-statefulset.yaml
```

Each request is rejected.

Example:

```text
Forbidden registry:

nginx:latest

Must start with gcr.io/
```


## Step 4 — Deploy a Valid Pod

```bash
kubectl apply -f good-pod.yaml
```

This Pod uses:

```text
gcr.io/google-containers/pause:3.2
```

Because the image comes from an approved registry, the Pod is allowed.


## 3.3 Blocking NodePort Services

NodePort Services expose workloads directly on every node.

Many organizations prohibit NodePort and require developers to use:

- ClusterIP
- Ingress
- LoadBalancer

instead.


## Step 1 — Create the ConstraintTemplate

`k8s-no-nodeport.yaml`

```yaml
apiVersion: templates.gatekeeper.sh/v1
kind: ConstraintTemplate

metadata:
  name: nodeportnotallowed

spec:
  crd:
    spec:
      names:
        kind: NodePortNotAllowed

  targets:
  - target: admission.k8s.gatekeeper.sh
    rego: |
      package nodeportnotallowed

      violation[{"msg": msg}] {

        input.review.kind.kind == "Service"

        input.review.object.spec.type == "NodePort"

        msg := "NodePort Services are not allowed!"
      }
```

Apply it:

```bash
kubectl apply -f k8s-no-nodeport.yaml
```


## Step 2 — Create the Constraint

```yaml
apiVersion: constraints.gatekeeper.sh/v1beta1
kind: NodePortNotAllowed

metadata:
  name: deny-nodeport-in-marketing

spec:
  match:
    kinds:
    - apiGroups: [""]
      kinds:
      - Service

    namespaces:
    - marketing
```

Apply it:

```bash
kubectl apply -f no-nodeport-svc-in-marketing.yaml
```


## Step 3 — Test the Policy

Create a deployment.

```bash
kubectl create deployment hello-world \
  --namespace marketing \
  --image=gcr.io/google-samples/hello-app:1.0
```

Now expose it using NodePort.

```bash
kubectl expose deployment hello-world \
  --namespace marketing \
  --port=8080 \
  --target-port=8080 \
  --type=NodePort
```

Gatekeeper blocks the request.

```text
Error from server (Forbidden)

NodePort Services are not allowed!
```


## Step 4 — Use ClusterIP Instead

```bash
kubectl expose deployment hello-world \
  --namespace marketing \
  --port=8080 \
  --target-port=8080
```

Because the default Service type is **ClusterIP**, the Service is created successfully.


## 4. Summary

OPA Gatekeeper provides a powerful and flexible way to enforce consistent governance across Kubernetes clusters.

Using **ConstraintTemplates**, we define reusable policy types.

Using **Constraints**, we apply those policies to specific resources, namespaces, or workloads.

In this guide, we enforced three common security standards:

- Namespace labeling requirements
- Approved image registries
- Restricting NodePort Services

These examples represent only a small portion of what OPA can enforce.

As clusters grow, you can create policies for:

- RBAC
- Pod Security
- Resource requests and limits
- Networking
- Storage
- Secrets
- Cluster configuration
- Compliance requirements

Because policies are written as code, they can be version-controlled, peer-reviewed, tested, and deployed just like application code.


## Conclusion

OPA Gatekeeper gives Kubernetes administrators the guardrails needed to prevent unsafe or non-compliant workloads from reaching the cluster.

By validating manifests before they are admitted, teams can enforce consistent organizational standards without relying on manual reviews.

The examples in this article demonstrate how a few simple policies can significantly improve governance by ensuring namespaces follow labeling conventions, workloads use approved image registries, and insecure Service types are prohibited.

As your Kubernetes platform grows, policy-as-code becomes just as important as infrastructure-as-code. OPA Gatekeeper enables you to codify security and operational best practices, helping your clusters remain secure, predictable, and compliant at scale.