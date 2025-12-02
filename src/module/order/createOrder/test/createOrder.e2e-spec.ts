import { describe, beforeAll, afterAll, test, expect } from "@jest/globals";
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { DataSource } from "typeorm";
import { Order } from "../../Order";
import { Product } from "../../../product/Product";
import { buildApp } from "../../../../config/app";
import request from "supertest";
import { Express } from "express";

describe("US-3 : Créer une order - E2E", () => {
  let container: StartedPostgreSqlContainer;
  let dataSource: DataSource;
  let app: Express;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16")
      .withExposedPorts(5432)
      .start();

    dataSource = new DataSource({
      type: "postgres",
      host: container.getHost(),
      port: container.getPort(),
      username: container.getUsername(),
      password: container.getPassword(),
      database: container.getDatabase(),
      logging: false,
      entities: [Order, Product],
      synchronize: true,
      entitySkipConstructor: true,
    });

    await dataSource.initialize();

    const AppDataSource = require("../../../../config/db.config").default;

    app = buildApp();

    Object.assign(AppDataSource, dataSource);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.destroy();
    }
    if (container) {
      await container.stop();
    }
  });

  test("Scénario 1 : création réussie avec calcul du prix total", async () => {
    // Étant donné qu'un produit existe en base avec l'id 1 et un prix de 75€
    await dataSource.getRepository(Order).clear();
    await dataSource.getRepository(Product).clear();

    const product = new Product({
      title: "test",
      description: "test",
      price: 75,
    });
    await dataSource.getRepository(Product).save(product);

    // Quand je créé une commande avec un produit d'id 1 et une quantité de 2
    const response = await request(app)
      .post("/api/order")
      .send({
        productId: product.id,
        quantity: 2,
      })
      .set("Content-Type", "application/json");

    // Alors la commande doit être créée avec un prix total de 150€ (75€ * 2)
    expect(response.status).toBe(201);
    const orders = await dataSource.getRepository(Order).find();
    expect(orders).toHaveLength(1);
    expect(orders[0].totalPrice).toBe(150);
  });

  test("Scénario 2 : échec, prix total supérieur ou égal à 200€", async () => {
    // Étant donné qu'un produit existe en base avec un prix de 100€
    await dataSource.getRepository(Order).clear();
    await dataSource.getRepository(Product).clear();

    const product = new Product({
      title: "test2",
      description: "test2",
      price: 100,
    });
    await dataSource.getRepository(Product).save(product);

    // Quand je créé une commande avec une quantité de 2 (prix total calculé = 200€)
    const response = await request(app)
      .post("/api/order")
      .send({
        productId: product.id,
        quantity: 2,
      })
      .set("Content-Type", "application/json");

    // Alors une erreur doit être envoyée "le prix par commande doit être inférieur à 200€"
    expect(response.status).toBe(400);
    expect(response.body.message).toBe(
      "le prix par commande doit être inférieur à 200€"
    );

    // Vérification qu'aucune commande n'a été créée
    const orders = await dataSource.getRepository(Order).find();
    expect(orders).toHaveLength(0);
  });
});
